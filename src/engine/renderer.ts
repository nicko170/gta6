import { Mat4, Vec3, mat4 } from './math';
import terrainShader from '../shaders/terrain.wgsl?raw';
import objectShader from '../shaders/object.wgsl?raw';
import skyShader from '../shaders/sky.wgsl?raw';

export interface Mesh {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  pipeline: 'terrain' | 'object';
}

export interface RenderObject {
  mesh: Mesh;
  modelMatrix: Mat4;
}

// Vertex layout: pos(3) + normal(3) + uv(2) + color(4) = 12 floats
const VERTEX_STRIDE = 12 * 4;

const VERTEX_BUFFER_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VERTEX_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },   // position
    { shaderLocation: 1, offset: 12, format: 'float32x3' },  // normal
    { shaderLocation: 2, offset: 24, format: 'float32x2' },  // uv
    { shaderLocation: 3, offset: 32, format: 'float32x4' },  // color
  ],
};

// Uniform buffer: viewProjection(64) + model(64) + cameraPos(12) + time(4) + sunDir(12) + fogDensity(4) + fogColor(12) + pad(4) = 176 bytes
const UNIFORM_SIZE = 176;
// Sky uniforms: invViewProj(64) + cameraPos(12) + time(4) + sunDir(12) + pad(4) = 96
const SKY_UNIFORM_SIZE = 96;

export class Renderer {
  device!: GPUDevice;
  context!: GPUCanvasContext;
  format!: GPUTextureFormat;
  depthTexture!: GPUTexture;
  canvas: HTMLCanvasElement;

  terrainPipeline!: GPURenderPipeline;
  objectPipeline!: GPURenderPipeline;
  skyPipeline!: GPURenderPipeline;

  dynamicUniformBuffer!: GPUBuffer;
  dynamicBindGroup!: GPUBindGroup;
  skyUniformBuffer!: GPUBuffer;
  skyBindGroup!: GPUBindGroup;
  bindGroupLayout!: GPUBindGroupLayout;

  // Dynamic uniform buffer sizing
  uniformStride = 256; // Will be set to minUniformBufferOffsetAlignment
  maxObjects = 2048;

  width = 0;
  height = 0;

  sunDirection: Vec3 = [0.5, 0.8, 0.3];
  fogDensity = 0.8;
  fogColor: Vec3 = [0.6, 0.75, 0.9];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<boolean> {
    if (!navigator.gpu) {
      alert('WebGPU not supported! Use Chrome 113+ or Edge 113+');
      return false;
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) { alert('No GPU adapter found'); return false; }

    this.device = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: 256 * 1024 * 1024,
      }
    });

    this.context = this.canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });

    this.resize();
    this.createPipelines();
    this.createBuffers();

    return true;
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    if (this.depthTexture) this.depthTexture.destroy();
    this.depthTexture = this.device.createTexture({
      size: [this.width, this.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private createPipelines() {
    // Dynamic uniform buffer bind group layout for per-object data
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true },
      }],
    });

    // Sky uses a separate non-dynamic layout
    const skyBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    const skyPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [skyBindGroupLayout],
    });

    const createPipeline = (shader: string, depthWrite: boolean, cullMode: GPUCullMode = 'back'): GPURenderPipeline => {
      const module = this.device.createShaderModule({ code: shader });
      return this.device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module,
          entryPoint: 'vs_main',
          buffers: [VERTEX_BUFFER_LAYOUT],
        },
        fragment: {
          module,
          entryPoint: 'fs_main',
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list', cullMode },
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled: depthWrite,
          depthCompare: 'less',
        },
      });
    };

    this.terrainPipeline = createPipeline(terrainShader, true, 'none');
    this.objectPipeline = createPipeline(objectShader, true, 'back');

    // Sky pipeline - no vertex buffers, fullscreen triangle
    const skyModule = this.device.createShaderModule({ code: skyShader });
    this.skyPipeline = this.device.createRenderPipeline({
      layout: skyPipelineLayout,
      vertex: { module: skyModule, entryPoint: 'vs_main' },
      fragment: {
        module: skyModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });
  }

  private createBuffers() {
    // Get the actual minimum alignment from the device
    this.uniformStride = Math.max(256, UNIFORM_SIZE);
    // Round up to 256 alignment
    this.uniformStride = Math.ceil(this.uniformStride / 256) * 256;

    // Large dynamic uniform buffer for all objects
    this.dynamicUniformBuffer = this.device.createBuffer({
      size: this.uniformStride * this.maxObjects,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.dynamicBindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{
        binding: 0,
        resource: {
          buffer: this.dynamicUniformBuffer,
          offset: 0,
          size: UNIFORM_SIZE,
        },
      }],
    });

    // Sky gets its own static uniform buffer
    this.skyUniformBuffer = this.device.createBuffer({
      size: SKY_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const skyBindGroupLayout = this.skyPipeline.getBindGroupLayout(0);
    this.skyBindGroup = this.device.createBindGroup({
      layout: skyBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.skyUniformBuffer } }],
    });
  }

  createMesh(vertices: Float32Array, indices: Uint32Array, pipeline: 'terrain' | 'object' = 'object'): Mesh {
    const vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, vertices);

    const indexBuffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(indexBuffer, 0, indices);

    return { vertexBuffer, indexBuffer, indexCount: indices.length, pipeline };
  }

  render(objects: RenderObject[], viewMatrix: Mat4, cameraPos: Vec3, time: number) {
    const projection = mat4.perspective(Math.PI / 3, this.width / this.height, 0.5, 2000);
    const viewProjection = mat4.multiply(projection, viewMatrix);
    const invViewProjection = mat4.invert(viewProjection);

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.5, g: 0.7, b: 0.9, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // Draw sky first
    const skyData = new Float32Array(SKY_UNIFORM_SIZE / 4);
    skyData.set(invViewProjection, 0);
    skyData.set(cameraPos, 16);
    skyData[19] = time;
    skyData.set(this.sunDirection, 20);
    this.device.queue.writeBuffer(this.skyUniformBuffer, 0, skyData);

    renderPass.setPipeline(this.skyPipeline);
    renderPass.setBindGroup(0, this.skyBindGroup);
    renderPass.draw(3);

    // Write all object uniforms into the dynamic buffer
    const allUniformData = new Float32Array(this.uniformStride / 4 * objects.length);
    const strideFloats = this.uniformStride / 4;

    for (let i = 0; i < objects.length; i++) {
      const offset = i * strideFloats;
      const obj = objects[i];
      allUniformData.set(viewProjection, offset);
      allUniformData.set(obj.modelMatrix, offset + 16);
      allUniformData.set(cameraPos, offset + 32);
      allUniformData[offset + 35] = time;
      allUniformData.set(this.sunDirection, offset + 36);
      allUniformData[offset + 39] = this.fogDensity;
      allUniformData.set(this.fogColor, offset + 40);
    }
    this.device.queue.writeBuffer(this.dynamicUniformBuffer, 0, allUniformData);

    // Draw objects grouped by pipeline
    const terrainObjs: { obj: RenderObject; index: number }[] = [];
    const objectObjs: { obj: RenderObject; index: number }[] = [];
    for (let i = 0; i < objects.length; i++) {
      const entry = { obj: objects[i], index: i };
      if (objects[i].mesh.pipeline === 'terrain') terrainObjs.push(entry);
      else objectObjs.push(entry);
    }

    const drawBatch = (pipeline: GPURenderPipeline, objs: { obj: RenderObject; index: number }[]) => {
      renderPass.setPipeline(pipeline);
      for (const { obj, index } of objs) {
        const dynamicOffset = index * this.uniformStride;
        renderPass.setBindGroup(0, this.dynamicBindGroup, [dynamicOffset]);
        renderPass.setVertexBuffer(0, obj.mesh.vertexBuffer);
        renderPass.setIndexBuffer(obj.mesh.indexBuffer, 'uint32');
        renderPass.drawIndexed(obj.mesh.indexCount);
      }
    };

    drawBatch(this.terrainPipeline, terrainObjs);
    drawBatch(this.objectPipeline, objectObjs);

    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }
}

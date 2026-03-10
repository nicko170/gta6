struct Uniforms {
  viewProjection: mat4x4<f32>,
  model: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  sunDirection: vec3<f32>,
  fogDensity: f32,
  fogColor: vec3<f32>,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) color: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) color: vec4<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let worldPos = (uniforms.model * vec4<f32>(input.position, 1.0)).xyz;
  output.position = uniforms.viewProjection * vec4<f32>(worldPos, 1.0);
  output.worldPos = worldPos;
  output.normal = normalize((uniforms.model * vec4<f32>(input.normal, 0.0)).xyz);
  output.uv = input.uv;
  output.color = input.color;
  return output;
}

// ---- Procedural noise helpers ----

fn hash2(p: vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn hash2v(p: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453),
    fract(sin(dot(p, vec2<f32>(269.5, 183.3))) * 43758.5453)
  );
}

fn valueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2(i);
  let b = hash2(i + vec2<f32>(1.0, 0.0));
  let c = hash2(i + vec2<f32>(0.0, 1.0));
  let d = hash2(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var val = 0.0;
  var amp = 0.5;
  var freq = 1.0;
  var pos = p;
  for (var i = 0; i < octaves; i++) {
    val += valueNoise(pos * freq) * amp;
    freq *= 2.17;
    amp *= 0.48;
    // Rotate to break axis alignment
    pos = vec2<f32>(pos.x * 0.866 - pos.y * 0.5, pos.x * 0.5 + pos.y * 0.866);
  }
  return val;
}

fn voronoiNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  var minDist = 1.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let neighbor = vec2<f32>(f32(x), f32(y));
      let point = hash2v(i + neighbor);
      let diff = neighbor + point - f;
      let dist = dot(diff, diff);
      minDist = min(minDist, dist);
    }
  }
  return sqrt(minDist);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let N = normalize(input.normal);
  let L = normalize(uniforms.sunDirection);
  let V = normalize(uniforms.cameraPos - input.worldPos);

  // --- Determine surface type from vertex color ---
  let baseColor = input.color.rgb;
  let luminance = dot(baseColor, vec3<f32>(0.299, 0.587, 0.114));
  let saturation = (max(max(baseColor.r, baseColor.g), baseColor.b) - min(min(baseColor.r, baseColor.g), baseColor.b));
  let isGrassy = smoothstep(0.03, 0.12, saturation) * smoothstep(0.0, 0.1, baseColor.g - baseColor.r);
  let isRoad = (1.0 - isGrassy) * smoothstep(0.15, 0.45, luminance) * (1.0 - smoothstep(0.0, 0.15, saturation));

  // Height and slope-based surface detection
  let height = input.worldPos.y;
  let slope = 1.0 - max(N.y, 0.0);
  let isMountain = smoothstep(20.0, 50.0, height);
  let isRock = smoothstep(0.25, 0.55, slope);
  let isSnow = smoothstep(80.0, 115.0, height) * smoothstep(0.5, 0.2, slope);

  // Water detection from vertex color (blue-dominant)
  let isWaterSurface = smoothstep(0.0, 0.08, baseColor.b - max(baseColor.r, baseColor.g)) * smoothstep(0.4, 0.6, baseColor.b);

  // --- World-space procedural coordinates ---
  let worldUV = input.worldPos.xz;

  // --- Grass color variation ---
  let grassNoise1 = fbm(worldUV * 0.05, 4);
  let grassNoise2 = fbm(worldUV * 0.15 + vec2<f32>(50.0, 80.0), 3);
  let grassDetail = fbm(worldUV * 0.8, 3);

  let grassWarm = vec3<f32>(0.28, 0.42, 0.08);
  let grassCool = vec3<f32>(0.15, 0.35, 0.12);
  let grassDry  = vec3<f32>(0.38, 0.38, 0.12);
  var grassColor = mix(grassCool, grassWarm, grassNoise1);
  grassColor = mix(grassColor, grassDry, grassNoise2 * 0.35);
  grassColor *= 0.85 + 0.3 * grassDetail;

  // --- Mountain rock coloring ---
  let rockNoise1 = fbm(worldUV * 0.08, 5);
  let rockNoise2 = fbm(worldUV * 0.4 + vec2<f32>(30.0, 60.0), 3);
  let rockColor1 = vec3<f32>(0.52, 0.48, 0.42); // warm sandstone
  let rockColor2 = vec3<f32>(0.58, 0.54, 0.48); // lighter rock
  let rockColor3 = vec3<f32>(0.44, 0.42, 0.38); // darker crevice
  var rockColor = mix(rockColor1, rockColor2, rockNoise1);
  rockColor = mix(rockColor, rockColor3, rockNoise2 * 0.4);
  rockColor *= 0.88 + 0.24 * fbm(worldUV * 1.5, 2);

  // Dirt/scree at mid-altitude steep areas
  let dirtNoise = fbm(worldUV * 0.12 + vec2<f32>(100.0, 200.0), 3);
  let dirtColor = vec3<f32>(0.48, 0.38, 0.26) * (0.9 + 0.2 * dirtNoise);
  let isDirt = smoothstep(15.0, 35.0, height) * smoothstep(0.15, 0.35, slope) * (1.0 - smoothstep(0.5, 0.7, slope));

  // Snow
  let snowSparkle = fbm(worldUV * 3.0, 2);
  var snowColor = vec3<f32>(0.92, 0.93, 0.97) * (0.92 + 0.16 * snowSparkle);
  // Patchy snow at medium heights
  let snowPatch = fbm(worldUV * 0.06 + vec2<f32>(200.0, 100.0), 4);
  let patchySnow = smoothstep(65.0, 85.0, height) * smoothstep(0.35, 0.15, slope) * smoothstep(0.4, 0.65, snowPatch);

  // Mountain grass (higher altitude grass is drier/yellower)
  let alpineGrass = vec3<f32>(0.38, 0.42, 0.16);
  let foothillGrass = vec3<f32>(0.30, 0.40, 0.14);
  let mountainGrass = mix(foothillGrass, alpineGrass, smoothstep(20.0, 60.0, height));

  // Blend rock/snow/dirt/mountain grass by slope and height
  var mountainColor = mix(mountainGrass, rockColor, isRock);
  mountainColor = mix(mountainColor, dirtColor, isDirt * (1.0 - isRock));
  mountainColor = mix(mountainColor, snowColor, isSnow);
  mountainColor = mix(mountainColor, snowColor * 0.95, patchySnow * (1.0 - isRock));

  // --- Road surface variation ---
  let roadNoise = fbm(worldUV * 0.3, 3);
  let roadDetail = fbm(worldUV * 2.0, 2);
  let roadPatches = voronoiNoise(worldUV * 0.08);
  var roadColor = baseColor;
  roadColor *= 0.88 + 0.24 * roadNoise;
  roadColor *= 0.94 + 0.12 * roadDetail;
  let patchFactor = smoothstep(0.3, 0.35, roadPatches) * smoothstep(0.55, 0.5, roadPatches);
  roadColor = mix(roadColor, roadColor * 1.12, patchFactor * 0.5);

  // Road markings
  let roadLine = smoothstep(0.48, 0.49, input.uv.x) - smoothstep(0.51, 0.52, input.uv.x);
  roadColor = mix(roadColor, vec3<f32>(0.9, 0.88, 0.7), roadLine * 0.8);

  // --- Water coloring ---
  let waterShallow = vec3<f32>(0.08, 0.32, 0.42);
  let waterDeep = vec3<f32>(0.02, 0.08, 0.22);
  var waterColor = mix(waterShallow, waterDeep, smoothstep(0.0, 3.0, max(0.0, -height)));
  // Animated ripples
  let ripple1 = sin(worldUV.x * 1.8 + uniforms.time * 1.5) * sin(worldUV.y * 2.2 + uniforms.time * 1.1) * 0.04;
  let ripple2 = sin(worldUV.x * 4.0 - uniforms.time * 0.8) * sin(worldUV.y * 3.5 + uniforms.time * 1.3) * 0.02;
  waterColor += vec3<f32>(ripple1 + ripple2);
  // Fresnel-based sky reflection
  let fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  let skyReflect = vec3<f32>(0.35, 0.5, 0.65);
  waterColor = mix(waterColor, skyReflect, fresnel * 0.6);

  // --- Blend surface types ---
  var surfaceColor = baseColor;
  surfaceColor = mix(surfaceColor, grassColor, isGrassy * (1.0 - isMountain) * (1.0 - isWaterSurface));
  surfaceColor = mix(surfaceColor, roadColor, isRoad * (1.0 - isWaterSurface));
  surfaceColor = mix(surfaceColor, mountainColor, isMountain * (1.0 - isRoad) * (1.0 - isWaterSurface));
  surfaceColor = mix(surfaceColor, waterColor, isWaterSurface);

  // For generic surfaces (not grass, not road, not mountain, not water), add subtle noise
  let genericNoise = fbm(worldUV * 0.2, 3);
  let genericMask = (1.0 - isGrassy) * (1.0 - isRoad) * (1.0 - isMountain) * (1.0 - isWaterSurface);
  surfaceColor = mix(surfaceColor, surfaceColor * (0.85 + 0.3 * genericNoise), genericMask);

  // --- Lighting ---
  let NdotL = max(dot(N, L), 0.0);

  let wrapFactor = 0.3;
  let wrappedNdotL = max((dot(N, L) + wrapFactor) / (1.0 + wrapFactor), 0.0);

  let sunColor = vec3<f32>(1.05, 0.95, 0.82);
  let diffuse = sunColor * wrappedNdotL;

  let skyAmbient = vec3<f32>(0.14, 0.20, 0.32);
  let groundAmbient = vec3<f32>(0.12, 0.10, 0.06);
  let ambientBlend = N.y * 0.5 + 0.5;
  var ambient = mix(groundAmbient, skyAmbient, ambientBlend);

  // Boost ambient for mountain terrain (prevents steep slopes going black)
  let mountainAmbientBoost = isMountain * 0.12;
  ambient = ambient + vec3<f32>(mountainAmbientBoost * 0.8, mountainAmbientBoost * 0.85, mountainAmbientBoost);

  let heightAO = smoothstep(-8.0, 2.0, input.worldPos.y);
  // Softer normal AO for mountains so cliffs aren't pitch black
  let normalAO = mix(0.6 + 0.4 * max(N.y, 0.0), 0.75 + 0.25 * max(N.y, 0.0), isMountain);
  let ao = heightAO * normalAO;

  let fillDir = normalize(vec3<f32>(-L.x, 0.2, -L.z));
  let fillStrength = mix(0.08, 0.15, isMountain); // stronger fill on mountains
  let fillLight = max(dot(N, fillDir), 0.0) * fillStrength;
  let fillColor = vec3<f32>(0.5, 0.6, 0.8);

  let lighting = (ambient * ao + diffuse * 0.82 + fillColor * fillLight);

  // Specular
  let H = normalize(L + V);
  let NdotH = max(dot(N, H), 0.0);
  let roadSpec = pow(NdotH, 64.0) * 0.15 * isRoad;
  let grassSpec = pow(NdotH, 8.0) * 0.04 * isGrassy;
  let snowSpec = pow(NdotH, 32.0) * 0.2 * isSnow;
  let waterSpec = pow(NdotH, 128.0) * 0.6 * isWaterSurface;

  var finalColor = surfaceColor * lighting + sunColor * (roadSpec + grassSpec + snowSpec + waterSpec);

  // --- Fog with atmospheric perspective ---
  let dist = distance(input.worldPos, uniforms.cameraPos);
  let baseFog = 1.0 - exp(-dist * uniforms.fogDensity * 0.001);
  // Height-based fog (thicker near ground)
  let heightFog = exp(-max(input.worldPos.y - uniforms.cameraPos.y, 0.0) * 0.005);
  let fogFactor = clamp(baseFog * (0.5 + 0.5 * heightFog), 0.0, 1.0);

  // Fog color tinted slightly by sun direction (warm toward sun, cool away)
  let viewDir = normalize(input.worldPos - uniforms.cameraPos);
  let sunViewDot = max(dot(viewDir, L), 0.0);
  let fogTint = mix(uniforms.fogColor, uniforms.fogColor * vec3<f32>(1.15, 1.05, 0.85), pow(sunViewDot, 3.0) * 0.4);

  finalColor = mix(finalColor, fogTint, fogFactor);

  // Slight tone-mapping to keep highlights in range
  finalColor = finalColor / (finalColor + vec3<f32>(1.0));
  // Gamma approximation for richer colors
  finalColor = pow(finalColor, vec3<f32>(0.92));

  return vec4<f32>(finalColor, 1.0);
}

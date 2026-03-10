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

// ---- Noise helpers ----

fn hash2(p: vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn hash3(p: vec3<f32>) -> f32 {
  let h = dot(p, vec3<f32>(127.1, 311.7, 74.7));
  return fract(sin(h) * 43758.5453123);
}

fn valueNoise3D(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i + vec3<f32>(0,0,0)), hash3(i + vec3<f32>(1,0,0)), u.x),
        mix(hash3(i + vec3<f32>(0,1,0)), hash3(i + vec3<f32>(1,1,0)), u.x), u.y),
    mix(mix(hash3(i + vec3<f32>(0,0,1)), hash3(i + vec3<f32>(1,0,1)), u.x),
        mix(hash3(i + vec3<f32>(0,1,1)), hash3(i + vec3<f32>(1,1,1)), u.x), u.y),
    u.z
  );
}

fn fbm3D(p: vec3<f32>, octaves: i32) -> f32 {
  var val = 0.0;
  var amp = 0.5;
  var pos = p;
  for (var i = 0; i < octaves; i++) {
    val += valueNoise3D(pos) * amp;
    pos *= 2.13;
    amp *= 0.47;
  }
  return val;
}

// GGX/Trowbridge-Reitz NDF
fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * denom * denom + 0.0001);
}

// Schlick Fresnel
fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
  let t = clamp(1.0 - cosTheta, 0.0, 1.0);
  let t2 = t * t;
  return F0 + (vec3<f32>(1.0) - F0) * (t2 * t2 * t);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let N = normalize(input.normal);
  let L = normalize(uniforms.sunDirection);
  let V = normalize(uniforms.cameraPos - input.worldPos);
  let H = normalize(L + V);
  let NdotL = max(dot(N, L), 0.0);
  let NdotH = max(dot(N, H), 0.0);
  let NdotV = max(dot(N, V), 0.0);
  let VdotH = max(dot(V, H), 0.0);

  var baseColor = input.color.rgb;
  let alpha = input.color.a;

  // --- Detect material type from vertex color ---
  let luminance = dot(baseColor, vec3<f32>(0.299, 0.587, 0.114));
  let saturation = max(max(baseColor.r, baseColor.g), baseColor.b) - min(min(baseColor.r, baseColor.g), baseColor.b);

  // Window detection: blueish tones (b > r, b > g) or dark with blue tint
  let isWindow = smoothstep(0.0, 0.08, baseColor.b - max(baseColor.r, baseColor.g))
               * smoothstep(0.05, 0.25, baseColor.b);

  // Metal detection: saturated and medium-bright (car paint, metal structures)
  let isMetal = smoothstep(0.08, 0.25, saturation) * smoothstep(0.2, 0.5, luminance);

  // Dark surface detection (tires, dark trim)
  let isDark = smoothstep(0.2, 0.08, luminance);

  // Roughness: windows are smooth, metal medium, default rough
  var roughness = 0.65;
  roughness = mix(roughness, 0.35, isMetal);
  roughness = mix(roughness, 0.08, isWindow);
  roughness = mix(roughness, 0.85, isDark);

  // Metallic F0
  let dielectricF0 = vec3<f32>(0.04);
  let metalF0 = baseColor * 0.7 + vec3<f32>(0.3);
  let F0 = mix(dielectricF0, metalF0, isMetal * 0.6);

  // --- Subtle color variation / grunge ---
  let grungeScale = 0.3;
  let grunge = fbm3D(input.worldPos * grungeScale, 3);
  let grunge2 = fbm3D(input.worldPos * 1.5 + vec3<f32>(100.0, 0.0, 50.0), 2);

  // Darken edges and crevices with grunge
  baseColor *= 0.88 + 0.24 * grunge;
  // Micro color shift for visual interest
  baseColor += (grunge2 - 0.5) * 0.04;
  baseColor = max(baseColor, vec3<f32>(0.0));

  // --- Lighting ---
  let sunColor = vec3<f32>(1.05, 0.95, 0.82);

  // Wrapped diffuse for softer shadow falloff
  let wrap = 0.25;
  let wrappedDiffuse = max((dot(N, L) + wrap) / (1.0 + wrap), 0.0);
  let diffuse = sunColor * wrappedDiffuse;

  // GGX specular
  let D = distributionGGX(NdotH, roughness);
  let F = fresnelSchlick(VdotH, F0);
  // Simplified visibility term
  let vis = 0.25 / (max(NdotL * NdotV, 0.001));
  let specular = sunColor * D * F * vis * NdotL;

  // --- Hemispherical ambient ---
  let skyAmbientColor = vec3<f32>(0.16, 0.22, 0.35);
  let groundBounceColor = vec3<f32>(0.12, 0.09, 0.05);
  let ambientBlend = N.y * 0.5 + 0.5;
  var ambient = mix(groundBounceColor, skyAmbientColor, ambientBlend);

  // Ambient occlusion approximation from vertex normal orientation and grunge
  let ao = (0.5 + 0.5 * N.y) * (0.7 + 0.3 * grunge);
  ambient *= ao;

  // --- Rim lighting (Fresnel edge glow) ---
  let fresnel = pow(1.0 - NdotV, 4.0);
  // Rim picks up sky color from above, warm from below
  let rimColor = mix(
    vec3<f32>(0.15, 0.10, 0.05),
    vec3<f32>(0.2, 0.3, 0.5),
    smoothstep(-0.2, 0.5, N.y)
  );
  // Rim is stronger on the sun-facing side
  let rimSunFactor = 0.4 + 0.6 * max(dot(N, L), 0.0);
  let rim = rimColor * fresnel * 0.6 * rimSunFactor;

  // --- Back light / fill for depth ---
  let backDir = normalize(vec3<f32>(-L.x, 0.15, -L.z));
  let backLight = max(dot(N, backDir), 0.0) * 0.06;
  let backColor = vec3<f32>(0.4, 0.5, 0.7);

  // --- Emissive for windows ---
  // Windows glow slightly, stronger at dawn/dusk (when sun is low)
  let sunHeight = max(L.y, 0.0);
  let windowGlowStrength = mix(0.5, 0.15, smoothstep(0.0, 0.5, sunHeight));
  let windowEmissive = vec3<f32>(0.35, 0.55, 0.85) * isWindow * windowGlowStrength;

  // --- Combine lighting ---
  // Diffuse contribution (metals absorb less diffuse)
  let diffuseContrib = (1.0 - isMetal * 0.6) * baseColor * (ambient + diffuse * 0.82);
  let specContrib = specular;
  let fillContrib = backColor * backLight;

  var finalColor = diffuseContrib + specContrib + rim + fillContrib + windowEmissive;

  // --- Fog with atmospheric scattering ---
  let dist = distance(input.worldPos, uniforms.cameraPos);
  let baseFog = 1.0 - exp(-dist * uniforms.fogDensity * 0.001);
  // Height-based fog attenuation
  let heightFog = exp(-max(input.worldPos.y - uniforms.cameraPos.y, 0.0) * 0.004);
  let fogFactor = clamp(baseFog * (0.4 + 0.6 * heightFog), 0.0, 1.0);

  // Inscattering: fog is warmer looking toward the sun
  let viewDir = normalize(input.worldPos - uniforms.cameraPos);
  let sunViewDot = max(dot(viewDir, L), 0.0);
  let fogTint = mix(
    uniforms.fogColor,
    uniforms.fogColor * vec3<f32>(1.2, 1.05, 0.82),
    pow(sunViewDot, 4.0) * 0.45
  );

  finalColor = mix(finalColor, fogTint, fogFactor);

  // Reinhard tone mapping
  finalColor = finalColor / (finalColor + vec3<f32>(1.0));
  // Slight contrast boost / gamma
  finalColor = pow(finalColor, vec3<f32>(0.92));

  return vec4<f32>(finalColor, alpha);
}

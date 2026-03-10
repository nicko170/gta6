struct Uniforms {
  invViewProjection: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  sunDirection: vec3<f32>,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) rayDir: vec3<f32>,
};

// Full-screen triangle
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;
  // Generate full-screen triangle
  let x = f32(i32(vertexIndex) / 2) * 4.0 - 1.0;
  let y = f32(i32(vertexIndex) % 2) * 4.0 - 1.0;
  output.position = vec4<f32>(x, y, 0.999, 1.0);

  // Compute ray direction
  let clipPos = vec4<f32>(x, y, 1.0, 1.0);
  let worldPos = uniforms.invViewProjection * clipPos;
  output.rayDir = normalize(worldPos.xyz / worldPos.w - uniforms.cameraPos);
  return output;
}

// ---- Noise helpers ----

fn hash(p: vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn hash2(p: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453),
    fract(sin(dot(p, vec2<f32>(269.5, 183.3))) * 43758.5453)
  );
}

fn valueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // Quintic smoothstep
  let a = hash(i);
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var val = 0.0;
  var amp = 0.5;
  var pos = p;
  for (var i = 0; i < octaves; i++) {
    val += valueNoise(pos) * amp;
    amp *= 0.48;
    // Rotate each octave to reduce axis-aligned artifacts
    pos = vec2<f32>(pos.x * 0.866 - pos.y * 0.5, pos.x * 0.5 + pos.y * 0.866) * 2.12;
  }
  return val;
}

// Warped fbm for more organic cloud shapes
fn warpedFbm(p: vec2<f32>) -> f32 {
  let warp1 = vec2<f32>(fbm(p + vec2<f32>(0.0, 0.0), 4), fbm(p + vec2<f32>(5.2, 1.3), 4));
  let warp2 = vec2<f32>(fbm(p + warp1 * 1.5 + vec2<f32>(1.7, 9.2), 4), fbm(p + warp1 * 1.5 + vec2<f32>(8.3, 2.8), 4));
  return fbm(p + warp2 * 0.8, 5);
}

// Star hash
fn starHash(p: vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(1273.1, 4117.7));
  return fract(sin(h) * 43758.5453123);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let dir = normalize(input.rayDir);
  let sunDir = normalize(uniforms.sunDirection);
  let sunHeight = sunDir.y;

  // ---- Atmospheric scattering approximation ----
  let t = max(dir.y, 0.0);

  // Rayleigh-inspired sky colors that shift with sun height
  // Zenith color: deep blue when sun is high, dark blue-purple at night
  let zenithDay = vec3<f32>(0.18, 0.35, 0.78);
  let zenithSunset = vec3<f32>(0.12, 0.15, 0.45);
  let zenithNight = vec3<f32>(0.005, 0.007, 0.02);
  var zenith = mix(zenithNight, zenithDay, smoothstep(-0.1, 0.3, sunHeight));
  zenith = mix(zenith, zenithSunset, smoothstep(0.3, 0.05, sunHeight) * smoothstep(-0.1, 0.05, sunHeight));

  // Horizon color
  let horizonDay = vec3<f32>(0.55, 0.72, 0.92);
  let horizonSunset = vec3<f32>(0.85, 0.45, 0.2);
  let horizonNight = vec3<f32>(0.01, 0.012, 0.025);
  var horizon = mix(horizonNight, horizonDay, smoothstep(-0.1, 0.3, sunHeight));
  horizon = mix(horizon, horizonSunset, smoothstep(0.35, 0.0, sunHeight) * smoothstep(-0.15, 0.05, sunHeight));

  // Sky gradient with non-linear falloff
  var sky = mix(horizon, zenith, pow(t, 0.45));

  // ---- Sunset/sunrise color band near horizon ----
  let sunsetBandHeight = smoothstep(0.0, 0.12, t) * smoothstep(0.35, 0.12, t);
  let sunsetIntensity = smoothstep(0.3, 0.0, sunHeight) * smoothstep(-0.15, 0.0, sunHeight);

  // View angle relative to sun direction (horizontal)
  let viewSunDotH = dot(normalize(vec2<f32>(dir.x, dir.z)), normalize(vec2<f32>(sunDir.x, sunDir.z)));
  let sunProximity = max(viewSunDotH, 0.0);

  // Warm sunset colors near the sun side of the horizon
  let sunsetColor1 = vec3<f32>(1.0, 0.35, 0.05);  // Deep orange
  let sunsetColor2 = vec3<f32>(1.0, 0.65, 0.25);   // Golden
  let sunsetColor3 = vec3<f32>(0.9, 0.4, 0.55);     // Pink/magenta
  var sunsetGradient = mix(sunsetColor3, sunsetColor2, pow(sunProximity, 1.5));
  sunsetGradient = mix(sunsetGradient, sunsetColor1, pow(sunProximity, 4.0));

  sky += sunsetGradient * sunsetBandHeight * sunsetIntensity * (0.3 + 0.7 * sunProximity);

  // ---- Mie scattering glow around sun ----
  let sunDot = max(dot(dir, sunDir), 0.0);

  // Large atmospheric glow
  let mieGlow = pow(sunDot, 4.0) * 0.35;
  let mieColor = mix(vec3<f32>(1.0, 0.75, 0.4), vec3<f32>(1.0, 0.9, 0.7), smoothstep(0.0, 0.4, sunHeight));
  sky += mieColor * mieGlow;

  // ---- Sun disc ----
  let sunAngular = acos(min(sunDot, 1.0));
  let sunRadius = 0.018;
  let sunEdge = smoothstep(sunRadius, sunRadius * 0.6, sunAngular);
  let sunLimb = 1.0 - pow(sunAngular / sunRadius, 0.5) * 0.3; // Limb darkening
  let sunBrightness = mix(2.0, 4.0, smoothstep(0.0, 0.3, sunHeight));
  let sunDiscColor = vec3<f32>(1.0, 0.96, 0.88) * sunBrightness * max(sunLimb, 0.7);
  sky += sunDiscColor * sunEdge;

  // ---- Lens flare / bloom rings ----
  let flareRing1 = smoothstep(0.022, 0.02, sunAngular) * smoothstep(0.016, 0.018, sunAngular);
  let flareRing2 = smoothstep(0.05, 0.045, sunAngular) * smoothstep(0.035, 0.04, sunAngular);
  let flareColor = vec3<f32>(1.0, 0.85, 0.5);
  sky += flareColor * (flareRing1 * 0.8 + flareRing2 * 0.2) * smoothstep(0.0, 0.1, sunHeight);

  // Broad corona bloom
  let corona = pow(sunDot, 64.0) * 1.5;
  sky += vec3<f32>(1.0, 0.92, 0.75) * corona;

  // ---- Stars (visible when sun is low) ----
  let starVisibility = smoothstep(0.05, -0.15, sunHeight);
  if (starVisibility > 0.001 && dir.y > 0.0) {
    // Project direction onto a grid for star placement
    let starScale = 120.0;
    let starUV = dir.xz / (dir.y + 0.001) * starScale;
    let starCell = floor(starUV);
    let starFrac = fract(starUV);

    let starRand = starHash(starCell);
    let starPos = hash2(starCell) * 0.6 + 0.2;
    let starDist = length(starFrac - starPos);

    // Only show ~20% of cells as stars
    let starMask = step(0.8, starRand);
    // Star brightness varies
    let starBright = starRand * starRand * 2.0;
    // Twinkle
    let twinkle = 0.6 + 0.4 * sin(uniforms.time * (2.0 + starRand * 4.0) + starRand * 100.0);

    let starPoint = smoothstep(0.06, 0.0, starDist) * starMask * starBright * twinkle;

    // Star color variation (blue-white to warm)
    let starColorSeed = fract(starRand * 7.37);
    let starColor = mix(
      vec3<f32>(0.7, 0.8, 1.0),
      vec3<f32>(1.0, 0.9, 0.7),
      starColorSeed
    );

    sky += starColor * starPoint * starVisibility * smoothstep(0.0, 0.3, t);
  }

  // ---- Clouds ----
  let cloudHeight = 800.0;
  let cloudHeight2 = 1400.0;
  if (dir.y > 0.005) {
    // --- Lower cloud layer (main cumulus) ---
    let cloudT = (cloudHeight - uniforms.cameraPos.y) / dir.y;
    let cloudPos = uniforms.cameraPos.xz + dir.xz * cloudT;
    let cloudUV = cloudPos * 0.00025 + uniforms.time * 0.004;

    // Use warped FBM for more interesting cloud shapes
    let cloudShape = warpedFbm(cloudUV * 2.5);

    // Additional detail noise
    let cloudDetail = fbm(cloudUV * 8.0 + vec2<f32>(uniforms.time * 0.002), 4);

    // Cloud density with sharp-ish edges
    var cloudDensity = smoothstep(0.38, 0.58, cloudShape);
    cloudDensity *= 0.7 + 0.3 * cloudDetail;

    // Fade clouds near horizon to avoid hard cutoff
    let horizonFade = smoothstep(0.005, 0.2, dir.y);
    cloudDensity *= horizonFade;

    // Cloud lighting
    let cloudNdotL = 0.5 + 0.5 * sunDir.y;  // Top-lit approximation
    // Self-shadowing: thicker parts are darker underneath
    let cloudShadow = mix(0.55, 1.0, smoothstep(0.6, 0.3, cloudShape));

    // Sun-colored highlights on cloud tops
    let cloudHighlight = pow(max(dot(dir, sunDir), 0.0), 6.0);
    let cloudSunColor = mix(vec3<f32>(1.0, 0.6, 0.3), vec3<f32>(1.0, 0.97, 0.9), smoothstep(0.0, 0.3, sunHeight));

    // Base cloud color (white, tinted by sun)
    let cloudDayColor = vec3<f32>(0.95, 0.95, 0.97);
    let cloudSunsetColor = vec3<f32>(1.0, 0.7, 0.45);
    var cloudBase = mix(cloudSunsetColor, cloudDayColor, smoothstep(0.0, 0.25, sunHeight));
    cloudBase *= cloudShadow;
    cloudBase += cloudSunColor * cloudHighlight * 0.3;

    // Cloud ambient (slightly blue underneath)
    let cloudAmbient = vec3<f32>(0.5, 0.55, 0.7) * (1.0 - cloudNdotL) * 0.2;
    let cloudColor = cloudBase * (0.7 + 0.3 * cloudNdotL) + cloudAmbient;

    // Silver lining effect - bright edge when looking near the sun
    let silverLining = pow(sunDot, 12.0) * 0.4 *
      smoothstep(0.3, 0.5, cloudDensity) * smoothstep(0.7, 0.5, cloudDensity);
    let finalCloudColor = cloudColor + vec3<f32>(1.0, 0.95, 0.85) * silverLining;

    sky = mix(sky, finalCloudColor, cloudDensity * 0.85);

    // --- Upper wispy cloud layer (cirrus) ---
    let cloudT2 = (cloudHeight2 - uniforms.cameraPos.y) / dir.y;
    let cloudPos2 = uniforms.cameraPos.xz + dir.xz * cloudT2;
    let cirrusUV = cloudPos2 * 0.00015 + uniforms.time * 0.002;

    // Stretched, wispy shapes
    let cirrus = fbm(cirrusUV * vec2<f32>(3.0, 1.5), 5);
    let cirrusDensity = smoothstep(0.48, 0.65, cirrus) * 0.35 * horizonFade;

    let cirrusColor = mix(
      vec3<f32>(0.9, 0.6, 0.4),
      vec3<f32>(0.95, 0.95, 1.0),
      smoothstep(0.0, 0.25, sunHeight)
    );

    sky = mix(sky, cirrusColor, cirrusDensity);
  }

  // ---- Horizon haze / atmospheric scattering at horizon ----
  let hazeStrength = exp(-t * 6.0);
  let hazeColor = mix(
    mix(vec3<f32>(0.15, 0.08, 0.04), vec3<f32>(0.65, 0.75, 0.88), smoothstep(-0.1, 0.3, sunHeight)),
    vec3<f32>(0.9, 0.55, 0.25),
    sunsetIntensity * sunProximity * 0.6
  );
  sky += hazeColor * hazeStrength * 0.45;

  // ---- Below horizon - ground reflection/fog ----
  if (dir.y < 0.0) {
    let groundFog = mix(
      vec3<f32>(0.12, 0.10, 0.08),
      vec3<f32>(0.45, 0.50, 0.48),
      smoothstep(-0.1, 0.3, sunHeight)
    );
    let blendDown = smoothstep(0.0, -0.3, dir.y);
    // Tint ground fog toward horizon color
    let groundColor = mix(horizon, groundFog, blendDown);
    sky = mix(sky, groundColor, smoothstep(0.0, -0.08, dir.y));
  }

  // ---- Tone mapping ----
  // Slight exposure adjustment based on sun height (brighter midday)
  let exposure = mix(0.7, 1.1, smoothstep(-0.1, 0.4, sunHeight));
  var finalColor = sky * exposure;

  // Filmic tone mapping (ACES-inspired)
  let a2 = finalColor * 2.51 + vec3<f32>(0.03);
  let b2 = finalColor * 2.43 + vec3<f32>(0.59);
  finalColor = (finalColor * a2) / (finalColor * b2 + vec3<f32>(0.14));
  finalColor = clamp(finalColor, vec3<f32>(0.0), vec3<f32>(1.0));

  return vec4<f32>(finalColor, 1.0);
}

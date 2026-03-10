// Minimal 3D math library - vec3, mat4, quaternion

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Mat4 = Float32Array; // 16 floats, column-major
export type Quat = [number, number, number, number]; // x, y, z, w

export const vec3 = {
  create(x = 0, y = 0, z = 0): Vec3 { return [x, y, z]; },
  add(a: Vec3, b: Vec3): Vec3 { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; },
  sub(a: Vec3, b: Vec3): Vec3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; },
  scale(a: Vec3, s: number): Vec3 { return [a[0]*s, a[1]*s, a[2]*s]; },
  dot(a: Vec3, b: Vec3): number { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; },
  cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  },
  length(a: Vec3): number { return Math.sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2]); },
  normalize(a: Vec3): Vec3 {
    const l = vec3.length(a);
    if (l < 0.00001) return [0, 0, 0];
    return [a[0]/l, a[1]/l, a[2]/l];
  },
  lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
  },
  distance(a: Vec3, b: Vec3): number { return vec3.length(vec3.sub(a, b)); },
  negate(a: Vec3): Vec3 { return [-a[0], -a[1], -a[2]]; },
  copy(a: Vec3): Vec3 { return [a[0], a[1], a[2]]; },
  addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
    return [a[0]+b[0]*s, a[1]+b[1]*s, a[2]+b[2]*s];
  },
  rotateY(v: Vec3, angle: number): Vec3 {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [v[0]*c + v[2]*s, v[1], -v[0]*s + v[2]*c];
  },
};

export const mat4 = {
  create(): Mat4 {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  identity(m: Mat4): Mat4 {
    m.fill(0);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
    const m = new Float32Array(16);
    const f = 1 / Math.tan(fov / 2);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = far / (near - far);
    m[11] = -1;
    m[14] = (near * far) / (near - far);
    return m;
  },
  lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
    const z = vec3.normalize(vec3.sub(eye, target));
    const x = vec3.normalize(vec3.cross(up, z));
    const y = vec3.cross(z, x);
    const m = new Float32Array(16);
    m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[3] = 0;
    m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[7] = 0;
    m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[11] = 0;
    m[12] = -vec3.dot(x, eye);
    m[13] = -vec3.dot(y, eye);
    m[14] = -vec3.dot(z, eye);
    m[15] = 1;
    return m;
  },
  multiply(a: Mat4, b: Mat4): Mat4 {
    const m = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        m[j*4+i] = a[i]*b[j*4] + a[4+i]*b[j*4+1] + a[8+i]*b[j*4+2] + a[12+i]*b[j*4+3];
      }
    }
    return m;
  },
  translation(x: number, y: number, z: number): Mat4 {
    const m = mat4.create();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  },
  rotationY(angle: number): Mat4 {
    const m = mat4.create();
    const c = Math.cos(angle), s = Math.sin(angle);
    m[0] = c; m[2] = -s;
    m[8] = s; m[10] = c;
    return m;
  },
  rotationX(angle: number): Mat4 {
    const m = mat4.create();
    const c = Math.cos(angle), s = Math.sin(angle);
    m[5] = c; m[6] = s;
    m[9] = -s; m[10] = c;
    return m;
  },
  rotationZ(angle: number): Mat4 {
    const m = mat4.create();
    const c = Math.cos(angle), s = Math.sin(angle);
    m[0] = c; m[1] = s;
    m[4] = -s; m[5] = c;
    return m;
  },
  scaling(x: number, y: number, z: number): Mat4 {
    const m = new Float32Array(16);
    m[0] = x; m[5] = y; m[10] = z; m[15] = 1;
    return m;
  },
  invert(a: Mat4): Mat4 {
    const m = new Float32Array(16);
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3];
    const a10=a[4],a11=a[5],a12=a[6],a13=a[7];
    const a20=a[8],a21=a[9],a22=a[10],a23=a[11];
    const a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10;
    const b02=a00*a13-a03*a10, b03=a01*a12-a02*a11;
    const b04=a01*a13-a03*a11, b05=a02*a13-a03*a12;
    const b06=a20*a31-a21*a30, b07=a20*a32-a22*a30;
    const b08=a20*a33-a23*a30, b09=a21*a32-a22*a31;
    const b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
    let det = b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if (!det) return mat4.create();
    det = 1 / det;
    m[0]=(a11*b11-a12*b10+a13*b09)*det;
    m[1]=(a02*b10-a01*b11-a03*b09)*det;
    m[2]=(a31*b05-a32*b04+a33*b03)*det;
    m[3]=(a22*b04-a21*b05-a23*b03)*det;
    m[4]=(a12*b08-a10*b11-a13*b07)*det;
    m[5]=(a00*b11-a02*b08+a03*b07)*det;
    m[6]=(a32*b02-a30*b05-a33*b01)*det;
    m[7]=(a20*b05-a22*b02+a23*b01)*det;
    m[8]=(a10*b10-a11*b08+a13*b06)*det;
    m[9]=(a01*b08-a00*b10-a03*b06)*det;
    m[10]=(a30*b04-a31*b02+a33*b00)*det;
    m[11]=(a21*b02-a20*b04-a23*b00)*det;
    m[12]=(a11*b07-a10*b09-a12*b06)*det;
    m[13]=(a00*b09-a01*b07+a02*b06)*det;
    m[14]=(a31*b01-a30*b03-a32*b00)*det;
    m[15]=(a20*b03-a21*b01+a22*b00)*det;
    return m;
  },
  fromRotationTranslationScale(q: Quat, t: Vec3, s: Vec3): Mat4 {
    const m = new Float32Array(16);
    const [qx, qy, qz, qw] = q;
    const x2=qx+qx, y2=qy+qy, z2=qz+qz;
    const xx=qx*x2, xy=qx*y2, xz=qx*z2;
    const yy=qy*y2, yz=qy*z2, zz=qz*z2;
    const wx=qw*x2, wy=qw*y2, wz=qw*z2;
    m[0]=(1-(yy+zz))*s[0]; m[1]=(xy+wz)*s[0]; m[2]=(xz-wy)*s[0]; m[3]=0;
    m[4]=(xy-wz)*s[1]; m[5]=(1-(xx+zz))*s[1]; m[6]=(yz+wx)*s[1]; m[7]=0;
    m[8]=(xz+wy)*s[2]; m[9]=(yz-wx)*s[2]; m[10]=(1-(xx+yy))*s[2]; m[11]=0;
    m[12]=t[0]; m[13]=t[1]; m[14]=t[2]; m[15]=1;
    return m;
  }
};

export const quat = {
  identity(): Quat { return [0, 0, 0, 1]; },
  fromEuler(x: number, y: number, z: number): Quat {
    const cx=Math.cos(x/2), sx=Math.sin(x/2);
    const cy=Math.cos(y/2), sy=Math.sin(y/2);
    const cz=Math.cos(z/2), sz=Math.sin(z/2);
    return [
      sx*cy*cz - cx*sy*sz,
      cx*sy*cz + sx*cy*sz,
      cx*cy*sz - sx*sy*cz,
      cx*cy*cz + sx*sy*sz
    ];
  },
  fromAxisAngle(axis: Vec3, angle: number): Quat {
    const half = angle / 2;
    const s = Math.sin(half);
    return [axis[0]*s, axis[1]*s, axis[2]*s, Math.cos(half)];
  },
  multiply(a: Quat, b: Quat): Quat {
    return [
      a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
      a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
      a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
      a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]
    ];
  },
  normalize(q: Quat): Quat {
    const l = Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]);
    if (l < 0.00001) return [0, 0, 0, 1];
    return [q[0]/l, q[1]/l, q[2]/l, q[3]/l];
  },
  rotateVector(q: Quat, v: Vec3): Vec3 {
    const [qx, qy, qz, qw] = q;
    const ix = qw*v[0]+qy*v[2]-qz*v[1];
    const iy = qw*v[1]+qz*v[0]-qx*v[2];
    const iz = qw*v[2]+qx*v[1]-qy*v[0];
    const iw = -qx*v[0]-qy*v[1]-qz*v[2];
    return [
      ix*qw+iw*-qx+iy*-qz-iz*-qy,
      iy*qw+iw*-qy+iz*-qx-ix*-qz,
      iz*qw+iw*-qz+ix*-qy-iy*-qx
    ];
  },
  slerp(a: Quat, b: Quat, t: number): Quat {
    let dot = a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
    const bx = dot < 0 ? (dot = -dot, -b[0]) : b[0];
    const by = dot < 0 ? -b[1] : b[1];
    const bz = dot < 0 ? -b[2] : b[2];
    const bw = dot < 0 ? -b[3] : b[3];
    if (dot > 0.9995) {
      return quat.normalize([a[0]+(bx-a[0])*t, a[1]+(by-a[1])*t, a[2]+(bz-a[2])*t, a[3]+(bw-a[3])*t]);
    }
    const theta = Math.acos(dot);
    const sinT = Math.sin(theta);
    const s0 = Math.sin((1-t)*theta)/sinT;
    const s1 = Math.sin(t*theta)/sinT;
    return [a[0]*s0+bx*s1, a[1]*s0+by*s1, a[2]*s0+bz*s1, a[3]*s0+bw*s1];
  }
};

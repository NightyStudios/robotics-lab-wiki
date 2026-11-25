const right = [.864, .504, 0.0];
const up = [-.145, .249, .958];
const depth = [-.483, .828, -.287];
const scale = 1.6;
const origin = [.105, .87];
const gripOffset = [-.008, .0055];
const postHeight = .039;
const postMaterial = [.50, .63, .71];
const materials = [
  [.70, .79, .84],
  [.26, .37, .46],
  [.80, .87, .89],
];

const vertexSource = `#version 300 es
  layout(location=0) in vec3 position;
  layout(location=1) in vec3 normal;
  uniform mat4 model;
  uniform vec4 screen;
  out mediump vec3 surfaceNormal;
  void main() {
    vec3 p = (model * vec4(position * .0001, 1.0)).xyz;
    float x = dot(vec3(${right.map(value => value.toFixed(3)).join(',')}), p) * screen.x + screen.z;
    float y = dot(vec3(${up.join(',')}), p) * screen.y + screen.w;
    float z = dot(vec3(${depth.join(',')}), p) * 2.4;
    gl_Position = vec4(x, y, z, 1.0);
    surfaceNormal = mat3(model) * normal;
  }`;

const fragmentSource = `#version 300 es
  precision mediump float;
  in mediump vec3 surfaceNormal;
  uniform vec3 material;
  out vec4 color;
  void main() {
    vec3 normal = normalize(surfaceNormal);
    float key = max(dot(normal, normalize(vec3(-.35, -.65, .72))), 0.0);
    float rim = max(dot(normal, normalize(vec3(.68, .52, .43))), 0.0);
    float sheen = pow(max(dot(normal, normalize(vec3(.08, -.92, .62))), 0.0), 25.0);
    color = vec4(material * (.49 + key * .43 + rim * .23) + sheen * .095, 1.0);
  }`;

let modelFile;

function loadModel() {
  modelFile ??= fetch(new URL('./assets/so101-model.bin', import.meta.url)).then(async response => {
    if (!response.ok) throw new Error('SO-101 model unavailable');
    const file = await response.arrayBuffer();
    const headerSize = new DataView(file).getUint32(0, true);
    const header = new Uint8Array(file, 4, headerSize);
    const { rig, meshes, poses } = JSON.parse(new TextDecoder().decode(header));
    return { rig, meshes, poses, geometry: new Uint8Array(file, headerSize + 4) };
  });
  return modelFile;
}

function makeProgram(gl) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const detail = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`SO-101 shader unavailable: ${detail}`);
  }
  return program;
}

function multiply(result, parent, local) {
  for (let column = 0; column < 16; column += 4) {
    for (let row = 0; row < 4; row++) {
      result[column + row] = parent[row] * local[column] + parent[row + 4] * local[column + 1]
        + parent[row + 8] * local[column + 2] + parent[row + 12] * local[column + 3];
    }
  }
}

function rotateLocalZ(matrix, degrees) {
  const angle = degrees * Math.PI / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  for (let row = 0; row < 4; row++) {
    const x = matrix[row];
    const y = matrix[row + 4];
    matrix[row] = x * cos + y * sin;
    matrix[row + 4] = -x * sin + y * cos;
  }
}

function createPost(gl) {
  // Geometry uses the same 0.1 mm units as the arm model.
  const halfWidth = 60;
  const bottom = -88;
  const top = postHeight * 10000 + 24;
  const corners = [
    [-halfWidth, -halfWidth, bottom], [halfWidth, -halfWidth, bottom],
    [halfWidth, halfWidth, bottom], [-halfWidth, halfWidth, bottom],
    [-halfWidth, -halfWidth, top], [halfWidth, -halfWidth, top],
    [halfWidth, halfWidth, top], [-halfWidth, halfWidth, top],
  ];
  const faces = [
    [[0, 0, -1], [0, 3, 2, 1]], [[0, 0, 1], [4, 5, 6, 7]],
    [[1, 0, 0], [1, 2, 6, 5]], [[-1, 0, 0], [3, 0, 4, 7]],
    [[0, 1, 0], [2, 3, 7, 6]], [[0, -1, 0], [0, 1, 5, 4]],
  ];
  const vertices = faces.flatMap(([normal, face]) =>
    [0, 1, 2, 0, 2, 3].flatMap(index => [...corners[face[index]], ...normal]));
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  return buffer;
}

const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const degrees = 180 / Math.PI;
const minBendCosine = Math.cos(161 / degrees);
const maxBendCosine = Math.cos(16 / degrees);

export async function createArmScene(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
  if (!gl) return null;
  const { rig, meshes, poses, geometry } = await loadModel();
  const program = makeProgram(gl);
  const transforms = Array.from({ length: rig.length + 1 }, () => new Float32Array(16));
  transforms[0][0] = transforms[0][5] = transforms[0][10] = transforms[0][15] = 1;
  const model = gl.getUniformLocation(program, 'model');
  const material = gl.getUniformLocation(program, 'material');
  const screen = gl.getUniformLocation(program, 'screen');
  const vertices = gl.createBuffer();
  const indices = gl.createBuffer();
  const post = createPost(gl);
  const postTransform = new Float32Array(16);
  postTransform[10] = postTransform[15] = 1;
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(program);

  function setJoints(pan, shoulder, elbow) {
    const angles = [pan, shoulder, elbow, -shoulder - elbow, 67, -5, 0];
    rig.forEach(([parent, local], index) => {
      multiply(transforms[index + 1], transforms[parent], local);
      rotateLocalZ(transforms[index + 1], angles[index]);
    });
  }

  const tool = transforms.at(-1);
  setJoints(0, 0, 0);
  const panJoint = transforms[1];
  const panDirection = Math.sign(panJoint[10]);
  const pivotX = panJoint[12];
  const pivotY = panJoint[13];
  const [shoulderJoint, elbowJoint, wristJoint] = transforms.slice(2, 5);
  const pitchDirection = -Math.sign(shoulderJoint[9]);
  const shoulderX = shoulderJoint[12];
  const shoulderZ = shoulderJoint[14];
  const upperX = elbowJoint[12] - shoulderX;
  const upperZ = elbowJoint[14] - shoulderZ;
  const lowerX = wristJoint[12] - elbowJoint[12];
  const lowerZ = wristJoint[14] - elbowJoint[14];
  const upperLength = Math.hypot(upperX, upperZ);
  const lowerLength = Math.hypot(lowerX, lowerZ);
  const upperAngle = Math.atan2(upperZ, upperX);
  const elbowAngle = wrapAngle(Math.atan2(lowerZ, lowerX) - upperAngle);
  const wristOffsetX = tool[12] - wristJoint[12] + gripOffset[0];
  const wristOffsetZ = tool[14] - wristJoint[14];
  const [restShoulder, restElbow] = poses[Math.floor(poses.length / 2)][Math.floor(poses[0].length / 2)];
  const elbowBend = Math.sign(elbowAngle + pitchDirection * restElbow / degrees);
  const project = axis => axis[0] * tool[12] + axis[1] * tool[13] + axis[2] * tool[14];
  setJoints(0, restShoulder, restElbow);
  const restRight = project(right) + gripOffset[0] * right[0] + gripOffset[1] * right[1];
  const restUp = project(up) + gripOffset[0] * up[0] + gripOffset[1] * up[1];
  const lateralOffset = tool[13] - pivotY + gripOffset[1];
  const pivotRight = right[0] * pivotX + right[1] * pivotY;

  function aimAt(offsetX, offsetY, pixelsPerMeter, azimuth) {
    const sin = Math.sin(azimuth / degrees);
    const cos = Math.cos(azimuth / degrees);
    const screenX = restRight + offsetX / pixelsPerMeter;
    const screenY = restUp - offsetY / pixelsPerMeter;
    // Unproject the cursor onto the plane turned by the base joint.
    const along = (screenX - pivotRight - lateralOffset * (right[1] * cos - right[0] * sin))
      / (right[0] * cos + right[1] * sin);
    const worldX = pivotX + along * cos - lateralOffset * sin;
    const worldY = pivotY + along * sin + lateralOffset * cos;
    const worldZ = (screenY - up[0] * worldX - up[1] * worldY) / up[2];
    const x = pivotX + along - shoulderX - wristOffsetX;
    const z = worldZ - shoulderZ - wristOffsetZ;
    // Solve the shoulder–elbow triangle. Wrist pitch keeps the tool offset fixed.
    const cosine = (x * x + z * z - upperLength ** 2 - lowerLength ** 2) / (2 * upperLength * lowerLength);
    const bend = elbowBend * Math.acos(Math.max(minBendCosine, Math.min(maxBendCosine, cosine)));
    const shoulder = Math.atan2(z, x) - Math.atan2(lowerLength * Math.sin(bend), upperLength + lowerLength * Math.cos(bend));
    setJoints(azimuth / panDirection,
      wrapAngle(shoulder - upperAngle) * degrees / pitchDirection,
      wrapAngle(bend - elbowAngle) * degrees / pitchDirection);
  }

  function mountPosition(width, height, screenX, screenY) {
    return {
      x: width * (origin[0] + scale * screenX),
      y: height * origin[1] - width * scale * (screenY + up[2] * postHeight),
    };
  }

  function draw(offsetX, offsetY, width, height, azimuth = 0) {
    const pixelsPerMeter = width * scale;
    const originX = width * origin[0];
    const originY = height * origin[1];
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const pixelsWide = Math.round(width * ratio);
    const pixelsHigh = Math.round(height * ratio);
    if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
      canvas.width = pixelsWide;
      canvas.height = pixelsHigh;
      gl.viewport(0, 0, pixelsWide, pixelsHigh);
    }
    gl.uniform4f(screen, 2 * pixelsPerMeter / width, 2 * pixelsPerMeter / height,
      2 * originX / width - 1, 1 - 2 * originY / height);
    aimAt(offsetX, offsetY, pixelsPerMeter, azimuth);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    for (const [part, color, vertex, elements, count] of meshes) {
      gl.uniformMatrix4fv(model, false, transforms[part]);
      gl.uniform3fv(material, materials[color]);
      gl.vertexAttribPointer(0, 3, gl.SHORT, false, 10, vertex);
      gl.vertexAttribPointer(1, 3, gl.BYTE, true, 10, vertex + 6);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, elements);
    }
    // Draw the post in the same depth buffer so the near jaw can cover it as the wrist turns.
    const sin = Math.sin(azimuth / degrees);
    const cos = Math.cos(azimuth / degrees);
    const contactX = cos * gripOffset[0] - sin * gripOffset[1];
    const contactY = sin * gripOffset[0] + cos * gripOffset[1];
    postTransform[0] = postTransform[5] = cos;
    postTransform[1] = sin;
    postTransform[4] = -sin;
    postTransform[12] = tool[12] + contactX;
    postTransform[13] = tool[13] + contactY;
    postTransform[14] = tool[14];
    gl.bindBuffer(gl.ARRAY_BUFFER, post);
    gl.uniformMatrix4fv(model, false, postTransform);
    gl.uniform3fv(material, postMaterial);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
    return mountPosition(width, height, project(right) + right[0] * contactX + right[1] * contactY,
      project(up) + up[0] * contactX + up[1] * contactY);
  }

  return {
    draw,
    restMount: (width, height) => mountPosition(width, height, restRight, restUp),
    dispose() {
      gl.deleteBuffer(vertices);
      gl.deleteBuffer(indices);
      gl.deleteBuffer(post);
      gl.deleteProgram(program);
    },
  };
}

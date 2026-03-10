export class Input {
  keys: Set<string> = new Set();
  keysPressed: Set<string> = new Set(); // pressed this frame
  mouseX = 0;
  mouseY = 0;
  mouseDX = 0;
  mouseDY = 0;
  mouseClicked = false;
  locked = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.keysPressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });

    canvas.addEventListener('mousedown', () => {
      if (this.locked) {
        this.mouseClicked = true;
      }
    });
    canvas.addEventListener('click', () => {
      if (!this.locked) {
        canvas.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  isDown(key: string): boolean { return this.keys.has(key); }
  wasPressed(key: string): boolean { return this.keysPressed.has(key); }

  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseClicked = false;
    this.keysPressed.clear();
  }
}

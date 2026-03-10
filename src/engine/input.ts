export class Input {
  keys: Set<string> = new Set();
  keysPressed: Set<string> = new Set(); // pressed this frame
  mouseX = 0;
  mouseY = 0;
  mouseDX = 0;
  mouseDY = 0;
  mouseClicked = false;
  locked = false;

  // Touch / joystick state (normalized -1 to 1)
  touchMoveX = 0; // left joystick X (strafe / steer)
  touchMoveY = 0; // left joystick Y (forward / throttle)
  // right-side touch look feeds directly into mouseDX/mouseDY
  touchSprint = false;
  touchBrake = false;
  touchAction = false; // F key equivalent
  touchActionPressed = false; // single-frame press
  touchPunch = false; // left-click equivalent
  touchPunchPressed = false;
  touchNoseUp = false; // Space (flight)
  touchNoseDown = false; // Ctrl (flight)
  touchFlapsUp = false; // ArrowUp
  touchFlapsDown = false; // ArrowDown
  touchRudderLeft = false; // ArrowLeft
  touchRudderRight = false; // ArrowRight

  isMobile = false;

  // Touch tracking
  private leftStickId: number | null = null;
  private leftStickOrigin: [number, number] = [0, 0];
  private rightTouchId: number | null = null;
  private rightTouchLast: [number, number] = [0, 0];
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Keyboard
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.keysPressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    // Mouse
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
      if (!this.locked && !this.isMobile) {
        canvas.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });

    // Touch
    if (this.isMobile) {
      this.locked = true; // always "locked" on mobile (no pointer lock needed)
      this.initTouch();
    }
  }

  private initTouch() {
    const opts: AddEventListenerOptions = { passive: false };

    // We handle touches on the entire document to not miss any
    document.addEventListener('touchstart', (e) => this.onTouchStart(e), opts);
    document.addEventListener('touchmove', (e) => this.onTouchMove(e), opts);
    document.addEventListener('touchend', (e) => this.onTouchEnd(e), opts);
    document.addEventListener('touchcancel', (e) => this.onTouchEnd(e), opts);
  }

  private onTouchStart(e: TouchEvent) {
    e.preventDefault();
    const w = window.innerWidth;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      // Left half = movement joystick
      if (t.clientX < w * 0.4 && this.leftStickId === null) {
        this.leftStickId = t.identifier;
        this.leftStickOrigin = [t.clientX, t.clientY];
        this.touchMoveX = 0;
        this.touchMoveY = 0;

        // Show joystick visual
        this.showJoystick(t.clientX, t.clientY);
      }
      // Right half = camera look
      else if (t.clientX > w * 0.4 && this.rightTouchId === null) {
        // Don't claim if touch is on a button
        const el = document.elementFromPoint(t.clientX, t.clientY);
        if (el && (el as HTMLElement).classList?.contains('touch-btn')) continue;

        this.rightTouchId = t.identifier;
        this.rightTouchLast = [t.clientX, t.clientY];
      }
    }
  }

  private onTouchMove(e: TouchEvent) {
    e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      if (t.identifier === this.leftStickId) {
        const dx = t.clientX - this.leftStickOrigin[0];
        const dy = t.clientY - this.leftStickOrigin[1];
        const maxR = 50;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const clampedDist = Math.min(dist, maxR);
        const angle = Math.atan2(dy, dx);

        this.touchMoveX = (Math.cos(angle) * clampedDist) / maxR;
        this.touchMoveY = -(Math.sin(angle) * clampedDist) / maxR; // invert Y (up = positive)

        this.updateJoystick(
          this.leftStickOrigin[0],
          this.leftStickOrigin[1],
          this.leftStickOrigin[0] + Math.cos(angle) * clampedDist,
          this.leftStickOrigin[1] + Math.sin(angle) * clampedDist,
        );
      }

      if (t.identifier === this.rightTouchId) {
        this.mouseDX += t.clientX - this.rightTouchLast[0];
        this.mouseDY += t.clientY - this.rightTouchLast[1];
        this.rightTouchLast = [t.clientX, t.clientY];
      }
    }
  }

  private onTouchEnd(e: TouchEvent) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      if (t.identifier === this.leftStickId) {
        this.leftStickId = null;
        this.touchMoveX = 0;
        this.touchMoveY = 0;
        this.hideJoystick();
      }

      if (t.identifier === this.rightTouchId) {
        this.rightTouchId = null;
      }
    }
  }

  // Joystick visual
  private joystickBase: HTMLElement | null = null;
  private joystickThumb: HTMLElement | null = null;

  private showJoystick(x: number, y: number) {
    if (!this.joystickBase) {
      this.joystickBase = document.getElementById('joystick-base');
      this.joystickThumb = document.getElementById('joystick-thumb');
    }
    if (this.joystickBase && this.joystickThumb) {
      this.joystickBase.style.display = 'block';
      this.joystickBase.style.left = (x - 60) + 'px';
      this.joystickBase.style.top = (y - 60) + 'px';
      this.joystickThumb.style.left = '40px';
      this.joystickThumb.style.top = '40px';
    }
  }

  private updateJoystick(bx: number, by: number, tx: number, ty: number) {
    if (this.joystickThumb) {
      this.joystickThumb.style.left = (40 + (tx - bx)) + 'px';
      this.joystickThumb.style.top = (40 + (ty - by)) + 'px';
    }
  }

  private hideJoystick() {
    if (this.joystickBase) {
      this.joystickBase.style.display = 'none';
    }
  }

  // Button state setters (called from HTML button event handlers)
  setTouchButton(name: string, pressed: boolean) {
    switch (name) {
      case 'sprint': this.touchSprint = pressed; break;
      case 'brake': this.touchBrake = pressed; break;
      case 'action':
        if (pressed && !this.touchAction) this.touchActionPressed = true;
        this.touchAction = pressed;
        break;
      case 'punch':
        if (pressed && !this.touchPunch) {
          this.touchPunchPressed = true;
          this.mouseClicked = true; // trigger punch via mouseClicked
        }
        this.touchPunch = pressed;
        break;
      case 'noseup': this.touchNoseUp = pressed; break;
      case 'nosedown': this.touchNoseDown = pressed; break;
      case 'flapsup': this.touchFlapsUp = pressed; break;
      case 'flapsdown': this.touchFlapsDown = pressed; break;
      case 'rudderleft': this.touchRudderLeft = pressed; break;
      case 'rudderright': this.touchRudderRight = pressed; break;
    }
  }

  // Unified accessors that merge keyboard + touch
  isDown(key: string): boolean {
    if (this.keys.has(key)) return true;
    if (!this.isMobile) return false;

    // Map touch state to key codes
    switch (key) {
      case 'KeyW': return this.touchMoveY > 0.2;
      case 'KeyS': return this.touchMoveY < -0.2;
      case 'KeyA': return this.touchMoveX < -0.2;
      case 'KeyD': return this.touchMoveX > 0.2;
      case 'ShiftLeft': return this.touchSprint;
      case 'Space': return this.touchBrake || this.touchNoseUp;
      case 'ControlLeft': case 'ControlRight': return this.touchNoseDown;
      case 'ArrowUp': return this.touchFlapsUp;
      case 'ArrowDown': return this.touchFlapsDown;
      case 'ArrowLeft': return this.touchRudderLeft;
      case 'ArrowRight': return this.touchRudderRight;
    }
    return false;
  }

  wasPressed(key: string): boolean {
    if (this.keysPressed.has(key)) return true;
    if (!this.isMobile) return false;

    switch (key) {
      case 'KeyF': return this.touchActionPressed;
    }
    return false;
  }

  // Touch-specific: get raw analog joystick value (for smoother vehicle control)
  getAxis(axis: 'moveX' | 'moveY' | 'steerX'): number {
    if (!this.isMobile) return 0;
    switch (axis) {
      case 'moveX': return this.touchMoveX;
      case 'moveY': return this.touchMoveY;
      case 'steerX': return this.touchMoveX;
    }
  }

  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseClicked = false;
    this.keysPressed.clear();
    this.touchActionPressed = false;
    this.touchPunchPressed = false;

  }
}

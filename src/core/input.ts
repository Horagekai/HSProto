type KeyHandler = (code: string) => void;

/** キーボード / マウス入力とポインタロックの管理 */
export class Input {
  private keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  onKeyDown: KeyHandler | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;

  private element: HTMLElement;

  constructor(element: HTMLElement) {
    this.element = element;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    document.addEventListener('pointerlockchange', this.handleLockChange);
    document.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('blur', this.handleBlur);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Tab') e.preventDefault();
    if (!this.keys.has(e.code)) this.onKeyDown?.(e.code);
    this.keys.add(e.code);
  };
  private handleKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private handleBlur = () => this.keys.clear();

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private handleLockChange = () => {
    this.locked = document.pointerLockElement === this.element;
    this.keys.clear();
    this.onLockChange?.(this.locked);
  };

  requestLock() {
    this.element.requestPointerLock();
  }

  down(code: string) {
    return this.keys.has(code);
  }

  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  dispose() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('pointerlockchange', this.handleLockChange);
    document.removeEventListener('mousemove', this.handleMouseMove);
  }
}

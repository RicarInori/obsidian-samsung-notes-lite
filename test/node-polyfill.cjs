/**
 * DOM globals preloaded with `node -r` for the tests.
 *
 * pdf.js touches `DOMMatrix` at module scope, which Chromium (and therefore Obsidian)
 * provides but Node does not. This is a test-only shim so the bundle can be loaded
 * headlessly — it is NOT shipped with the plugin.
 */

if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrix {
    constructor(init) {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
      if (Array.isArray(init) && init.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }
    multiplySelf() {
      return this;
    }
    preMultiplySelf() {
      return this;
    }
    translateSelf() {
      return this;
    }
    scaleSelf() {
      return this;
    }
    scale3dSelf() {
      return this;
    }
    rotateSelf() {
      return this;
    }
    rotateFromVectorSelf() {
      return this;
    }
    skewXSelf() {
      return this;
    }
    skewYSelf() {
      return this;
    }
    invertSelf() {
      return this;
    }
    flipX() {
      return this;
    }
    flipY() {
      return this;
    }
    transformPoint(p) {
      return p;
    }
  }
  globalThis.DOMMatrix = DOMMatrix;
}

if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    closePath() {}
    rect() {}
    addPath() {}
  };
}

if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(w, h) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  };
}
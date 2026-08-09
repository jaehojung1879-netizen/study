import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom does not implement matchMedia, which the theme controller reads on boot.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom defines window.scrollTo but throws "Not implemented" when called.
window.scrollTo = (() => {}) as unknown as typeof window.scrollTo;

// jsdom implements neither of these layout APIs.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

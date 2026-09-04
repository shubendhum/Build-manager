/**
 * The browser APIs jsdom does not implement, which components legitimately use.
 * Stubs, not fakes with behaviour — the tests here check that screens render,
 * not that a chart measures itself correctly.
 */
import { TextEncoder, TextDecoder } from "util";

// react-router v7 expects these on the global; jsdom's version predates that.
if (typeof global.TextEncoder === "undefined") global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === "undefined") global.TextDecoder = TextDecoder;

if (typeof global.ResizeObserver === "undefined") {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof window.matchMedia === "undefined") {
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  });
}

// jsdom has no layout, and several screens scroll a row into view on mount.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

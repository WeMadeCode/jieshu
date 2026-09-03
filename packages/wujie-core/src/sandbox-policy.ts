export const documentProxyProperties = {
  modifyLocalProperties: [
    "createElement",
    "createTextNode",
    "documentURI",
    "URL",
    "getElementsByTagName",
    "getElementById",
  ],
  modifyProperties: [
    "createElement",
    "createTextNode",
    "documentURI",
    "URL",
    "getElementsByTagName",
    "getElementsByClassName",
    "getElementsByName",
    "getElementById",
    "querySelector",
    "querySelectorAll",
    "documentElement",
    "scrollingElement",
    "forms",
    "images",
    "links",
  ],
  shadowProperties: [
    "activeElement",
    "childElementCount",
    "children",
    "firstElementChild",
    "firstChild",
    "fullscreenElement",
    "lastElementChild",
    "pictureInPictureElement",
    "pointerLockElement",
    "styleSheets",
  ],
  shadowMethods: [
    "append",
    "contains",
    "getSelection",
    "elementFromPoint",
    "elementsFromPoint",
    "getAnimations",
    "replaceChildren",
  ],
  documentProperties: [
    "characterSet",
    "compatMode",
    "contentType",
    "designMode",
    "dir",
    "doctype",
    "embeds",
    "fullscreenEnabled",
    "hidden",
    "implementation",
    "lastModified",
    "pictureInPictureEnabled",
    "plugins",
    "readyState",
    "referrer",
    "visibilityState",
    "fonts",
  ],
  documentMethods: [
    "execCommand",
    "caretPositionFromPoint",
    "createRange",
    "exitFullscreen",
    "exitPictureInPicture",
    "getElementsByTagNameNS",
    "hasFocus",
    "prepend",
  ],
  documentEvents: [
    "onpointerlockchange",
    "onpointerlockerror",
    "onbeforecopy",
    "onbeforecut",
    "onbeforepaste",
    "onfreeze",
    "onresume",
    "onsearch",
    "onfullscreenchange",
    "onfullscreenerror",
    "onsecuritypolicyviolation",
    "onvisibilitychange",
  ],
  ownerProperties: ["head", "body"],
};

export const sandboxEventPolicy = {
  document: {
    iframeListeners: ["DOMContentLoaded", "readystatechange"],
    iframeProperties: ["onreadystatechange"],
    hostListeners: [
      "fullscreenchange",
      "fullscreenerror",
      "selectionchange",
      "visibilitychange",
      "wheel",
      "keydown",
      "keypress",
      "keyup",
    ],
    hostAndShadowListeners: ["gotpointercapture", "lostpointercapture"],
  },
  window: {
    iframeListeners: [
      "hashchange",
      "popstate",
      "DOMContentLoaded",
      "load",
      "beforeunload",
      "unload",
      "message",
      "error",
      "unhandledrejection",
    ],
    iframeProperties: ["onload", "onbeforeunload", "onunload", "onerror", "onunhandledrejection"],
  },
};

export const appDocumentAddEventListenerEvents = sandboxEventPolicy.document.iframeListeners;
export const appDocumentOnEvents = sandboxEventPolicy.document.iframeProperties;
export const mainDocumentAddEventListenerEvents = sandboxEventPolicy.document.hostListeners;
export const mainAndAppAddEventListenerEvents = sandboxEventPolicy.document.hostAndShadowListeners;
export const appWindowAddEventListenerEvents = sandboxEventPolicy.window.iframeListeners;
export const appWindowOnEvent = sandboxEventPolicy.window.iframeProperties;

interface RelativeElementAttribute {
  readonly attribute: string;
  readonly property?: string;
  readonly sourceSet?: boolean;
}

export const relativeElementTagAttrMap: Readonly<Record<string, readonly RelativeElementAttribute[] | undefined>> = {
  A: [{ attribute: "href" }],
  AREA: [{ attribute: "href" }],
  AUDIO: [{ attribute: "src" }],
  BUTTON: [{ attribute: "formaction", property: "formAction" }],
  EMBED: [{ attribute: "src" }],
  FORM: [{ attribute: "action" }],
  IFRAME: [{ attribute: "src" }],
  IMG: [{ attribute: "src" }, { attribute: "srcset", sourceSet: true }],
  INPUT: [{ attribute: "src" }, { attribute: "formaction", property: "formAction" }],
  LINK: [{ attribute: "href" }],
  OBJECT: [{ attribute: "data" }],
  SCRIPT: [{ attribute: "src" }],
  SOURCE: [{ attribute: "src" }, { attribute: "srcset", sourceSet: true }],
  TRACK: [{ attribute: "src" }],
  VIDEO: [{ attribute: "src" }, { attribute: "poster" }],
};

export const windowProxyProperties = ["getComputedStyle", "visualViewport", "matchMedia", "DOMParser"];

export const windowRegWhiteList = [
  /animationFrame$/i,
  /resizeObserver$|mutationObserver$|intersectionObserver$/i,
  /height$|width$|left$/i,
  /^screen/i,
  /CSSStyleSheet$/i,
  /X$|Y$/,
];

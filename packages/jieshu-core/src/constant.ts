/** Stable DOM protocol names shared by the renderer, sandbox and cleanup paths. */
const elementProtocol = {
  appId: 'data-jieshu-id',
  scriptId: 'data-jieshu-script-id',
  patchedNode: 'data-jieshu-Flag',
  containerPosition: 'data-container-position-flag',
  containerOverflow: 'data-container-overflow-flag',
  loading: 'data-loading-flag',
  attachedCss: 'data-jieshu-attach-css-flag',
  fontStyleContainer: 'data-jieshu-font-style-container',
} as const;

export const {
  appId: JIESHU_APP_ID,
  scriptId: JIESHU_SCRIPT_ID,
  patchedNode: JIESHU_DATA_FLAG,
  containerPosition: CONTAINER_POSITION_DATA_FLAG,
  containerOverflow: CONTAINER_OVERFLOW_DATA_FLAG,
  loading: LOADING_DATA_FLAG,
  attachedCss: JIESHU_DATA_ATTACH_CSS_FLAG,
  fontStyleContainer: JIESHU_FONT_STYLE_CONTAINER_ATTR,
} = elementProtocol;

const runtimeProtocol = {
  iframeClass: 'jieshu_iframe',
  broadcastEvent: '_jieshu_all_event',
} as const;

export const { iframeClass: JIESHU_IFRAME_CLASS, broadcastEvent: JIESHU_ALL_EVENT } = runtimeProtocol;

export const JIESHU_SHADE_STYLE =
  'position: fixed; z-index: 2147483647; visibility: hidden; inset: 0px; backface-visibility: hidden;';
export const JIESHU_LOADING_STYLE =
  'position: absolute; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; z-index:1;';

export const JIESHU_LOADING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="30px" viewBox="0 0 24 30">
<rect x="0" y="13" width="4" height="5" fill="#909090">
  <animate attributeName="height" attributeType="XML" values="5;21;5" begin="0s" dur="0.6s" repeatCount="indefinite"></animate>
  <animate attributeName="y" attributeType="XML" values="13; 5; 13" begin="0s" dur="0.6s" repeatCount="indefinite"></animate>
</rect>
<rect x="10" y="13" width="4" height="5" fill="#909090">
  <animate attributeName="height" attributeType="XML" values="5;21;5" begin="0.15s" dur="0.6s" repeatCount="indefinite"></animate>
  <animate attributeName="y" attributeType="XML" values="13; 5; 13" begin="0.15s" dur="0.6s" repeatCount="indefinite"></animate>
</rect>
<rect x="20" y="13" width="4" height="5" fill="#909090">
  <animate attributeName="height" attributeType="XML" values="5;21;5" begin="0.3s" dur="0.6s" repeatCount="indefinite"></animate>
  <animate attributeName="y" attributeType="XML" values="13; 5; 13" begin="0.3s" dur="0.6s" repeatCount="indefinite"></animate>
</rect>
</svg>`;

const diagnosticText = {
  missingUrl: 'url参数为空',
  reloadDisabled: '子应用调用reload无法生效',
  stopHostExecution: '此报错可以忽略，iframe主动中断主应用代码在子应用运行',
  emptySubject: '事件订阅数量为空',
  missingFetch: 'window上不存在fetch属性，需要自行polyfill',
  unsupportedRuntime: '当前浏览器不支持界枢，运行时需要 Proxy 和 Custom Elements',
  scriptRequestFailed: '脚本请求出现错误',
  cssRequestFailed: '样式请求出现错误',
  htmlRequestFailed: 'html请求出现错误',
  repeatedRender: '界枢组件短时间重复渲染了两次，可能存在性能问题请检查代码',
  missingScript: '目标Script尚未准备好或已经被移除',
  invalidElementId: '不支持document.getElementById()传入特殊字符，请参考document.querySelector文档',
} as const;

export const {
  missingUrl: JIESHU_TIPS_NO_URL,
  reloadDisabled: JIESHU_TIPS_RELOAD_DISABLED,
  stopHostExecution: JIESHU_TIPS_STOP_APP,
  emptySubject: JIESHU_TIPS_NO_SUBJECT,
  missingFetch: JIESHU_TIPS_NO_FETCH,
  unsupportedRuntime: JIESHU_TIPS_NOT_SUPPORTED,
  scriptRequestFailed: JIESHU_TIPS_SCRIPT_ERROR_REQUESTED,
  cssRequestFailed: JIESHU_TIPS_CSS_ERROR_REQUESTED,
  htmlRequestFailed: JIESHU_TIPS_HTML_ERROR_REQUESTED,
  repeatedRender: JIESHU_TIPS_REPEAT_RENDER,
  missingScript: JIESHU_TIPS_NO_SCRIPT,
  invalidElementId: JIESHU_TIPS_GET_ELEMENT_BY_ID,
} = diagnosticText;

export const JIESHU_TIPS_STOP_APP_DETAIL = `${JIESHU_TIPS_STOP_APP}，详见：https://github.com/WeMadeCode/jieshu/issues`;

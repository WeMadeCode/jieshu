/** Stable DOM protocol names shared by the renderer, sandbox and cleanup paths. */
export const JIESHU_APP_ID = 'data-jieshu-id';
export const JIESHU_SCRIPT_ID = 'data-jieshu-script-id';
export const JIESHU_DATA_FLAG = 'data-jieshu-Flag';
export const CONTAINER_POSITION_DATA_FLAG = 'data-container-position-flag';
export const CONTAINER_OVERFLOW_DATA_FLAG = 'data-container-overflow-flag';
export const LOADING_DATA_FLAG = 'data-loading-flag';
export const JIESHU_DATA_ATTACH_CSS_FLAG = 'data-jieshu-attach-css-flag';
export const JIESHU_FONT_STYLE_CONTAINER_ATTR = 'data-jieshu-font-style-container';

export const JIESHU_IFRAME_CLASS = 'jieshu_iframe';
export const JIESHU_ALL_EVENT = '_jieshu_all_event';

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

export const JIESHU_TIPS_NO_URL = 'url参数为空';
export const JIESHU_TIPS_RELOAD_DISABLED = '子应用调用reload无法生效';
export const JIESHU_TIPS_STOP_APP = '此报错可以忽略，iframe主动中断主应用代码在子应用运行';
export const JIESHU_TIPS_NO_SUBJECT = '事件订阅数量为空';
export const JIESHU_TIPS_NO_FETCH = 'window上不存在fetch属性，需要自行polyfill';
export const JIESHU_TIPS_NOT_SUPPORTED = '当前浏览器不支持界枢，运行时需要 Proxy 和 Custom Elements';
export const JIESHU_TIPS_SCRIPT_ERROR_REQUESTED = '脚本请求出现错误';
export const JIESHU_TIPS_CSS_ERROR_REQUESTED = '样式请求出现错误';
export const JIESHU_TIPS_HTML_ERROR_REQUESTED = 'html请求出现错误';
export const JIESHU_TIPS_REPEAT_RENDER = '界枢组件短时间重复渲染了两次，可能存在性能问题请检查代码';
export const JIESHU_TIPS_NO_SCRIPT = '目标Script尚未准备好或已经被移除';
export const JIESHU_TIPS_GET_ELEMENT_BY_ID =
  '不支持document.getElementById()传入特殊字符，请参考document.querySelector文档';

// Preserve the existing string contract after the source constants become direct literals.
export const JIESHU_TIPS_STOP_APP_DETAIL: string = `${JIESHU_TIPS_STOP_APP}，详见：https://github.com/WeMadeCode/jieshu/issues`;

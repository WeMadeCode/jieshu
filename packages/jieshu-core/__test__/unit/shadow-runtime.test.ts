import {
  addLoading,
  createIframeContainer,
  getPatchStyleElements,
  repairRelativeElementUrl,
  removeLoading,
  renderElementToContainer,
} from '../../src/shadow';
import {
  CONTAINER_OVERFLOW_DATA_FLAG,
  CONTAINER_POSITION_DATA_FLAG,
  LOADING_DATA_FLAG,
  JIESHU_APP_ID,
} from '../../src/constant';

describe('shadow rendering primitives', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('accepts a named iframe-attribute interface and composes its style', () => {
    interface DegradeAttributes {
      title: string;
      sandbox: string;
      style: string;
    }

    const attributes: DegradeAttributes = {
      title: 'child application',
      sandbox: 'allow-scripts',
      style: 'border:0',
    };
    const iframe = createIframeContainer('catalog', attributes);

    expect(iframe.getAttribute(JIESHU_APP_ID)).toBe('catalog');
    expect(iframe.title).toBe('child application');
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('style')).toContain('height:100%;width:100%');
    expect(iframe.getAttribute('style')).toContain('border:0');
  });

  it('keeps a loading indicator while mounting the application element', () => {
    const container = document.createElement('main');
    const loading = document.createElement('div');
    const application = document.createElement('section');
    loading.setAttribute(LOADING_DATA_FLAG, '');
    container.appendChild(loading);

    renderElementToContainer(application, container);

    expect(container.children).toHaveLength(2);
    expect(container.firstElementChild).toBe(loading);
    expect(container.lastElementChild).toBe(application);
  });

  it('locks and restores container layout around a custom loading node', () => {
    const container = document.createElement('div');
    const staleContent = document.createElement('p');
    const customLoading = document.createElement('span');
    container.style.position = 'static';
    container.style.overflow = 'visible';
    staleContent.textContent = 'stale';
    customLoading.textContent = 'loading';
    container.appendChild(staleContent);
    document.body.appendChild(container);

    addLoading(container, customLoading);

    const indicator = container.querySelector(`div[${LOADING_DATA_FLAG}]`);
    expect(indicator?.firstElementChild).toBe(customLoading);
    expect(container.contains(staleContent)).toBe(false);
    expect(container.style.position).toBe('relative');
    expect(container.style.overflow).toBe('hidden');
    expect(container.getAttribute(CONTAINER_POSITION_DATA_FLAG)).toBe('static');
    expect(container.getAttribute(CONTAINER_OVERFLOW_DATA_FLAG)).toBe('');

    removeLoading(container);

    expect(container.querySelector(`div[${LOADING_DATA_FLAG}]`)).toBeNull();
    expect(container.style.position).toBe('');
    expect(container.style.overflow).toBe('');
    expect(container.hasAttribute(CONTAINER_POSITION_DATA_FLAG)).toBe(false);
    expect(container.hasAttribute(CONTAINER_OVERFLOW_DATA_FLAG)).toBe(false);
  });

  it('extracts host and font rules and ignores unreadable stylesheets', () => {
    const style = document.createElement('style');
    style.textContent = ':root { color: red; } @font-face { font-family: demo; src: url(demo.woff); }';
    document.head.appendChild(style);

    const unreadable = {} as CSSStyleSheet;
    Object.defineProperty(unreadable, 'cssRules', {
      get(): CSSRuleList {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    });

    const [hostStyle, fontStyle] = getPatchStyleElements([style.sheet, unreadable]);

    expect(hostStyle?.textContent).toContain(':host');
    expect(hostStyle?.textContent).not.toContain(':root');
    expect(fontStyle?.textContent).toContain('@font-face');
  });

  it('freezes adopted resource, navigation and form URLs against the child base', () => {
    const ownerDocument = document.implementation.createHTMLDocument('child');
    const base = ownerDocument.createElement('base');
    base.href = 'https://child.example/app/';
    ownerDocument.head.appendChild(base);
    const form = ownerDocument.createElement('form');
    form.setAttribute('action', 'submit');
    const frame = ownerDocument.createElement('iframe');
    frame.setAttribute('src', 'nested/page.html');
    const video = ownerDocument.createElement('video');
    video.setAttribute('poster', 'images/poster.jpg');
    const image = ownerDocument.createElement('img');
    image.setAttribute('srcset', 'small.png 1x, large.png 2x, data:image/png;base64,AAAA 3x');

    [form, frame, video, image].forEach(repairRelativeElementUrl);

    expect(form.getAttribute('action')).toBe('https://child.example/app/submit');
    expect(frame.getAttribute('src')).toBe('https://child.example/app/nested/page.html');
    expect(video.getAttribute('poster')).toBe('https://child.example/app/images/poster.jpg');
    expect(image.getAttribute('srcset')).toBe(
      'https://child.example/app/small.png 1x, https://child.example/app/large.png 2x, data:image/png;base64,AAAA 3x',
    );
  });
});

import WujieReact, { type WujieReactComponent, type WujieReactProps, type WujieReactRef } from 'wujie-react';
import SourceWujieReact from '../src';

const props: WujieReactProps = {
  name: 'typed-react-consumer',
  width: '100%',
  style: { minHeight: 320 },
};

const component: WujieReactComponent = WujieReact;
const sourceMatchesPublishedContract: typeof WujieReact = SourceWujieReact;
const publishedContractMatchesSource: typeof SourceWujieReact = WujieReact;
const rendered = component({
  ...props,
  ref(instance): void {
    void instance?.refresh();
    void instance?.destroy();
  },
});

const imperativeRef: WujieReactRef = {
  refresh: async () => undefined,
  destroy: async () => undefined,
};

WujieReact.bus.$emit('typed-react-consumer-ready');
WujieReact.setupApp({ name: props.name, url: 'https://example.test/' });
WujieReact.preloadApp({ name: props.name, url: 'https://example.test/' });
const refreshedApplication = WujieReact.refreshApp(props);
const destroyedApplication = WujieReact.destroyApp(props.name);
WujieReact.clearAssetsCache('https://example.test/');

// @ts-expect-error propTypes was removed from the public API.
WujieReact.propTypes;

// @ts-expect-error name remains the required application identity.
const missingName: WujieReactProps = {};

void rendered;
void imperativeRef;
void sourceMatchesPublishedContract;
void publishedContractMatchesSource;
void refreshedApplication;
void destroyedApplication;
void missingName;

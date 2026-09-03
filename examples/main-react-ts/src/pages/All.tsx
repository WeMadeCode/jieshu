import { useNavigate } from 'react-router-dom';

import hostMap from '../hostMap';
import WujieReact from '../wujieReact';

export default function All() {
  const navigate = useNavigate();
  const supportsAdvancedMode = typeof Proxy !== 'undefined';
  const props = {
    jump: (name: string): void => {
      void navigate(`/${name}`);
    },
  };

  return (
    <div className="all-apps">
      <div className="all-item">
        <WujieReact height="100%" width="100%" name="react16" url={hostMap('//localhost:7600/')} sync props={props} />
      </div>
      <div className="all-item">
        <WujieReact
          height="100%"
          width="100%"
          name="react17"
          url={hostMap('//localhost:7100/')}
          sync
          props={props}
          alive
        />
      </div>
      <div className="all-item">
        <WujieReact height="100%" width="100%" name="vue2" url={hostMap('//localhost:7200/')} sync props={props} />
      </div>
      {supportsAdvancedMode && (
        <div className="all-item">
          <WujieReact
            height="100%"
            width="100%"
            name="vue3"
            url={hostMap('//localhost:7300/')}
            sync
            props={props}
            alive
          />
        </div>
      )}
      {supportsAdvancedMode && (
        <div className="all-item">
          <WujieReact height="100%" width="100%" name="vite" url={hostMap('//localhost:7500/')} sync props={props} />
        </div>
      )}
      <div className="all-item">
        <WujieReact height="100%" width="100%" name="angular12" url={hostMap('//localhost:7400/')} sync props={props} />
      </div>
    </div>
  );
}

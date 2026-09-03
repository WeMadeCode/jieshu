import { useNavigate } from 'react-router-dom';

import hostMap from '../hostMap';
import WujieReact from '../wujieReact';

export default function Angular12() {
  const navigate = useNavigate();
  const props = {
    jump: (name: string): void => {
      void navigate(`/${name}`);
    },
  };

  return (
    <WujieReact width="100%" height="100%" name="angular12" url={hostMap('//localhost:7400/')} sync props={props} />
  );
}

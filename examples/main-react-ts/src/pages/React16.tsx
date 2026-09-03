import { useLocation, useNavigate } from "react-router-dom";

import hostMap from "../hostMap";
import WujieReact from "../wujieReact";

export default function React16() {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname.replace("/react16-sub", "").replace("/react16", "").replace("/", "");
  const react16Url = hostMap("//localhost:7600/") + path;
  const props = {
    jump: (name: string): void => {
      void navigate(`/${name}`);
    },
  };

  return (
    <WujieReact width="100%" height="100%" name="react16" url={react16Url} sync={!path} props={props} />
  );
}

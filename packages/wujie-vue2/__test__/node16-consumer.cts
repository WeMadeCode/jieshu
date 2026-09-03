import type { Properties as StandardCssProperties } from "csstype";
import type {
  WujieVueInstance,
  WujieVueProps,
  WujieVueStatics,
  WujieVueStyle,
} from "wujie-vue2";

declare const standardCssProperties: StandardCssProperties;
const style: WujieVueStyle = standardCssProperties;

declare const props: WujieVueProps;
declare const instance: WujieVueInstance;
declare const statics: WujieVueStatics;

void style;
void props;
void instance;
void statics;

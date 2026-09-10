# 代码规范

代码首先要便于人阅读。本规范适用于仓库中新增和修改的 JavaScript、TypeScript 代码，包括测试和文档示例。修改时遵守这些约定，保持改动范围与任务相关；现有代码在后续修改时逐步统一。

## 运行环境与兼容性

现代写法必须兼容仓库的编译目标和实际运行环境。目前目标为 ES2018，不能仅为使用 `Object.hasOwn` 等较新的运行时 API 而提高目标或忽略兼容性；`Object.prototype.hasOwnProperty.call(value, key)` 也是允许的安全写法。

## 对象属性访问

固定且可用标识符表示的属性名优先使用点号访问，不写成 `object['property']`。动态计算的属性名、Symbol 或包含连字符等无法用点号表示的属性名使用方括号。

项目启用了 `noPropertyAccessFromIndexSignature`。对于仅由索引签名提供的固定属性（如自定义环境变量），读取时优先使用解构；确实需要索引访问时可以保留方括号。不要为改用点号而关闭类型检查或添加类型断言。

```ts
const name = options.name;
const value = options[key];
const { JIESHU_REACT_MAIN_WORKSPACE: reactMainWorkspace } = process.env;
```

## 对象属性检查

禁止在对象实例上直接调用 `hasOwnProperty`、`isPrototypeOf`、`propertyIsEnumerable` 等 `Object.prototype` 检查方法。这些方法可能被同名属性覆盖，也可能因原型链为空而不存在。

使用静态或反射 API，或者显式调用原型方法。检查自有属性时，不能用 `in` 或 `Reflect.has` 替代，因为它们也会检查原型链。

```ts
const hasOwnPrototype = (value: object) => {
  return Reflect.getOwnPropertyDescriptor(value, 'prototype') !== undefined;
};

const isOwnEnumerable = (value: object, key: PropertyKey) => {
  return Reflect.getOwnPropertyDescriptor(value, key)?.enumerable === true;
};

const inheritsFrom = (prototype: object, value: unknown) => {
  return Object.prototype.isPrototypeOf.call(prototype, value);
};
```

## 控制流

`if`、`else`、`for`、`for...in`、`for...of`、`while`、`do...while` 的语句体必须使用大括号，语句另起一行。即使只有一条 `return`、`throw` 或赋值语句，也不省略大括号，不写成单行语句块。

```ts
if (cached !== undefined) {
  return cached;
}
```

条件和循环语句避免组合过多条件。循环边界与业务终止条件分开表达，在循环体内使用简短判断配合 `break` 或 `continue`；拆分时保持原有求值顺序和短路行为。

禁止嵌套三元表达式。多分支判断使用 `if` 或 `switch`，简单的二选一表达式可以保留三元运算符。

```ts
const requestErrorMessage = (kind: 'html' | 'style' | 'script') => {
  if (kind === 'html') {
    return 'HTML 请求失败';
  }
  if (kind === 'style') {
    return '样式请求失败';
  }
  return '脚本请求失败';
};
```

## 函数

### 函数写法

普通工具函数、导出函数和回调统一使用箭头函数。

```ts
export const isBoundedFunction = (fn: CallableFunction) => {
  return fn.name.startsWith('bound ') && Reflect.getOwnPropertyDescriptor(fn, 'prototype') === undefined;
};
```

依赖动态 `this`、`arguments`、构造能力、生成器、函数重载或声明提升语义时，可以保留普通函数或方法。不要为了箭头函数改变运行时行为；例外原因不明显时，在附近用简短注释说明。

```ts
// 需要验证绑定后的动态 this，保留普通函数。
const readOwner = function (this: Document) {
  return this;
};
```

### 长度与职责

单个函数不超过 100 行，块语句嵌套不超过 4 层。按独立职责提取辅助函数，使用提前返回减少嵌套；不要为缩短函数而将多条语句压到一行。

单个函数的圈复杂度不超过 30，由 ESLint 的 `complexity` 规则以错误级别检查。分支过多时，按职责拆分函数或简化判断，保持原有行为。

### 返回语句一致性

同一函数中，返回值的分支不要与裸 `return;` 或隐式落到函数末尾的分支混用。如果函数允许返回值缺省，相关分支显式使用 `return undefined;`，保持原有返回契约；抛出异常的分支不需要补返回语句。完全不返回值的函数可以使用裸 `return;` 提前结束，也可以自然结束。

```ts
const readContainerStyles = (container: HTMLElement) => {
  try {
    return window.getComputedStyle(container);
  } catch {
    return undefined;
  }
};
```

### 异步流程

拆分异步流程时，保持生命周期顺序、取消检查和异常清理边界。辅助函数的“需要继续下一阶段”和“操作已停止”必须能够区分；调用方需要捕获异步异常时，在 `try` 内使用 `return await`。

## 类型声明

### 返回类型优先推导

编译器能够正确推导时，不显式声明函数返回类型，包括 `boolean`、`void`、`Promise<T>` 等。参数仍需按严格类型检查要求声明类型。

类型守卫、递归推导限制、重载签名或需要固定公开契约时，可以保留必要的返回类型。导出函数不因导出这一点就必须显式标注返回类型。

```ts
const normalizeName = (name: string) => {
  return name.trim();
};

// 类型谓词用于收窄调用方的类型，不能简单改成 boolean。
const isCallable = (value: unknown): value is CallableFunction => {
  return typeof value === 'function';
};
```

### 可选成员和参数

可省略的成员和参数使用 `?`，不要用与 `undefined` 的联合类型表达可选性。

```ts
interface CacheBucket<Value> {
  visible?: Promise<Value> | null;
}

const load = (url: string, fetcher?: typeof fetch) => {
  return (fetcher ?? window.fetch)(url);
};
```

`null` 如果表示独立状态，应当保留。函数返回值或局部变量可能是 `undefined`，不等同于可选成员或参数，不应机械删除该类型。

### 类型中的函数属性

`type` 和 `interface` 中使用函数属性声明，不使用方法简写。此约定针对类型声明，不要求将依赖动态 `this` 的运行时方法改成箭头函数。

```ts
interface WindowReference {
  deref: () => Window | undefined;
}
```

### 非必要不使用类型断言

优先使用编译器推导、类型注解、运行时检查、类型守卫和控制流收窄。需要检查对象是否符合某个类型且编译配置支持时，可以使用 `satisfies`。

只有在真实类型约束已经得到保证、编译器仍无法表达或推导时，才允许使用 `as` 或非空断言 `!`，并说明成立依据。不要使用 `as unknown as T`、`as any`、关闭检查或无依据的类型谓词绕过类型错误；不要把类型断言换成隐式 `any`。类型断言和 `satisfies` 都不会执行运行时校验，外部数据仍需验证。

```ts
const value: unknown = Reflect.get(target, property);
if (!isCallable(value)) {
  throw new TypeError('Expected a callable value');
}

value();
```

## 字符串与默认值

### 字符串拼接

将变量插入字符串时使用模板字符串，不使用 `+` 拼接。

```ts
const baseURI = `${location.protocol}//${location.host}${location.pathname}`;
```

### 空值默认值

仅在值为 `null` 或 `undefined` 时提供默认值，使用 `??`。只有明确需要把 `false`、`0`、空字符串等所有假值都视为缺省时才使用 `||`；不要不加分析地替换既有逻辑。

## 日志与测试

允许使用 `console` 输出必要的运行诊断信息，也允许测试日志行为。ESLint 的 `no-console` 规则保持关闭；其他检查工具应采用一致的日志策略。

日志测试通过 `vi.spyOn(console, 'error')` 等 API 获取 spy，并使用该 spy 断言调用次数、参数和异常行为。测试结束后恢复 mock，避免影响其他用例。保留必要的日志断言，不吞掉异常，不混淆属性名。

## 检查方式

- ESLint 检查已配置的代码规则，包括通过 `no-prototype-builtins` 禁止实例上的原型检查方法调用。
- Prettier 负责缩进、换行等排版，不能替代语义检查，也不会自动为所有控制流补大括号。
- 代码审查应覆盖本文全部约定，重点检查控制流、函数职责、类型声明和例外的必要性；工具检查通过不代表已满足全部规范。
- 根据改动运行相关类型检查和行为测试，类型检查不能替代行为验证。具体测试要求见 [项目工作流](./AGENTS.md)。

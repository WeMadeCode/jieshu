# 代码规范

代码首先要便于人阅读。本规范适用于仓库中新增和修改的 JavaScript、TypeScript 代码，包括测试和文档示例。修改时遵守这些约定，保持改动范围与任务相关；现有代码在后续修改时逐步统一。

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

现代写法必须兼容仓库的编译目标和实际运行环境。目前目标为 ES2018，不能仅为使用 `Object.hasOwn` 等较新的运行时 API 而提高目标或忽略兼容性；`Object.prototype.hasOwnProperty.call(value, key)` 也是允许的安全写法。

## 控制流使用大括号

`if`、`else`、`for`、`for...in`、`for...of`、`while`、`do...while` 的语句体必须使用大括号，语句另起一行。即使只有一条 `return`、`throw` 或赋值语句，也不省略大括号，不写成单行语句块。

```ts
if (cached !== undefined) {
  return cached;
}
```

## 函数使用箭头函数

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

## 返回类型优先推导

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

## 非必要不使用类型断言

优先使用编译器推导、类型注解、运行时检查、类型守卫和控制流收窄。需要检查对象是否符合某个类型且编译配置支持时，可以使用 `satisfies`。

只有在真实类型约束已经得到保证、编译器仍无法表达或推导时，才允许使用 `as` 或非空断言 `!`，并说明成立依据。不要使用 `as unknown as T`、`as any`、关闭检查或无依据的类型谓词绕过类型错误；不要把类型断言换成隐式 `any`。类型断言和 `satisfies` 都不会执行运行时校验，外部数据仍需验证。

```ts
const value: unknown = Reflect.get(target, property);
if (!isCallable(value)) {
  throw new TypeError('Expected a callable value');
}

value();
```

## 检查方式

- `no-prototype-builtins` 已由 ESLint 约束实例上的原型方法调用。
- Prettier 负责缩进、换行等排版；不会自动为所有控制流补大括号。
- 大括号、箭头函数、返回类型推导和必要断言的约定均需在开发和代码审查时检查，目前尚未全部配置为 ESLint 强制规则。
- 运行与改动相关的类型检查和测试；类型检查通过不能替代行为验证。

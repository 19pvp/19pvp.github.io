declare module "*.module.css"

type ArrayElement<A> = A extends readonly (infer T)[] ? T : never
type DeepWriteable<T> = { -readonly [P in keyof T]: DeepWriteable<T[P]> }

type FromEntries<T> = T extends [infer Key, any][]
  ? { [K in (Key extends string ? Key : string)]: Extract<ArrayElement<T>, [K, any]>[1]}
  : { [key in string]: any }

type FromEntriesWithReadOnly<T> = FromEntries<DeepWriteable<T>>

// This is a fix of Object.entries types
interface ObjectConstructor {
  entries<T extends { [K: string]: unknown }>(o: T): [Extract<keyof T, string>, T[keyof T]][];

  fromEntries<T>(obj: T): FromEntriesWithReadOnly<T>;
}




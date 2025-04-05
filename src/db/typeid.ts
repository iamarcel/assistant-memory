import {
  IdType,
  newTypeId,
  TypeId,
  typeIdFromString,
  typeIdToString,
} from "../types/typeid";
import { customType } from "drizzle-orm/pg-core";

export const typeId = <const T extends IdType>(type: T) =>
  customType<{ data: TypeId<T>; default: true; driverData: string }>({
    dataType() {
      return "text";
    },
    fromDriver(value: string) {
      return typeIdFromString(type, value);
    },
    toDriver(value: TypeId<T>) {
      return typeIdToString(type, value);
    },
  })().$defaultFn(() => newTypeId(type));

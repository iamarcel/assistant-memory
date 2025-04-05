import { customType } from "drizzle-orm/pg-core";
import { IdType, TypeId, typeIdFromUuid, typeIdToUuid } from "~/types/typeid";

export const typeId = <const T extends IdType>(type: T) =>
  customType<{ data: TypeId<T>; default: true; driverData: string }>({
    dataType() {
      return "uuid";
    },
    fromDriver(value: string) {
      return typeIdFromUuid(type, value);
    },
    toDriver(value: TypeId<T>) {
      return typeIdToUuid(type, value);
    },
  });

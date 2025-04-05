import { z } from "zod";

const TYPE_ID_LENGTH = 26;

export const ID_TYPE_NAMES = [
  "node",
  "edge",
  "user",
  "node_metadata",
  "node_embedding",
  "source",
  "alias",
  "source_link",
  "user_profile",
] as const;

export const ID_TYPE_PREFIXES: Record<(typeof ID_TYPE_NAMES)[number], string> =
  {
    node: "node",
    edge: "edge",
    user: "user",
    node_metadata: "nmeta",
    node_embedding: "nemb",
    source: "src",
    alias: "alias",
    source_link: "sln",
    user_profile: "upf",
  } as const;

export type IdType = (typeof ID_TYPE_NAMES)[number];

export type IdTypePrefix<T extends IdType> = (typeof ID_TYPE_PREFIXES)[T];

export type TypeId<T extends IdType> = `${IdTypePrefix<T>}_${string}`;

export const typeIdSchema = <T extends IdType>(type: T) =>
  z
    .string()
    .startsWith(ID_TYPE_PREFIXES[type] + "_")
    .length(ID_TYPE_PREFIXES[type].length + 1 + TYPE_ID_LENGTH)
    .transform((input) => input as TypeId<T>);

export const typeIdFromUuid = <T extends IdType>(
  type: T,
  uuid: string
): TypeId<T> => `${ID_TYPE_PREFIXES[type]}_${uuid}`;

export const typeIdToUuid = <T extends IdType>(
  type: T,
  typeId: TypeId<T>
): string => typeId.split("_").pop()!;

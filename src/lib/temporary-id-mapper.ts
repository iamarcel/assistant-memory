/**
 * TemporaryIdMapper assigns unique temporary IDs to items of type T.
 * It generates IDs using a provided function, stores mappings, and
 * allows reverse lookup from ID back to original item.
 */
export class TemporaryIdMapper<T, ID extends string = string> {
  private readonly itemToId = new Map<T, ID>();
  private readonly idToItem = new Map<ID, T>();

  constructor(private readonly generateId: (item: T, index: number) => ID) {}

  /**
   * Maps an array of items to temporary IDs.
   * @param items - array of items to assign IDs to
   * @returns new array where each item has a 'tempId' property
   */
  public mapItems(items: T[]): Array<T & { tempId: ID }> {
    return items.map((item, index) => {
      const id = this.generateId(item, index);
      if (this.idToItem.has(id)) {
        throw new Error(`Duplicate temporary ID generated: ${id}`);
      }
      this.itemToId.set(item, id);
      this.idToItem.set(id, item);
      return { ...item, tempId: id } as T & { tempId: ID };
    });
  }

  /**
   * Get the temporary ID for a given item.
   * @param item - original item
   * @returns temporary ID if exists, undefined otherwise
   */
  public getId(item: T): ID | undefined {
    return this.itemToId.get(item);
  }

  /**
   * Get the original item for a given temporary ID.
   * @param id - temporary ID
   * @returns original item if exists, undefined otherwise
   */
  public getItem(id: ID): T | undefined {
    return this.idToItem.get(id);
  }

  /**
   * Returns all mappings as array of { item, id }.
   */
  public entries(): Array<{ item: T; id: ID }> {
    return Array.from(this.itemToId.entries()).map(([item, id]) => ({ item, id }));
  }
}

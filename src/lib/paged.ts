// One read returns at most 1,000 rows (max_rows), so a list that can be longer is read a page at
// a time: `read` asks for the 1,000 rows from `from`, ordered by something unique.
export async function pages<T>(read: (from: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await read(from);
    if (error) throw new Error("rows_not_read");
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

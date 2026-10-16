// Supabase（PostgREST）每次最多回 1000 筆；客戶／品項從凌越匯入後可能超過，
// 用 .limit(5000) 會被靜默截斷。這裡分頁抓到完為止（2026-10-17 總檢查）。
export async function fetchAllPages<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
  max = 50000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await make(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

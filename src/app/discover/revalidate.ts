import { revalidatePath, revalidateTag } from "next/cache";

export function revalidateDiscoverCatalog() {
  revalidateTag("discover", { expire: 0 });
  revalidatePath("/discover");
  revalidatePath("/");
}

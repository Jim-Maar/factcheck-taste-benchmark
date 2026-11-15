import { readdirSync, readFileSync, writeFileSync } from "fs";
import { displayText, embeddedPost, toXMedia, type SyndicationTweet } from "../scripts/import/xPosts";
const all = new Map<string, SyndicationTweet>();
for (const c of readdirSync("scripts/ai/checks")) {
  try { for (const f of readdirSync(`scripts/ai/checks/${c}/posts`)) { const t = JSON.parse(readFileSync(`scripts/ai/checks/${c}/posts/${f}`, "utf8")); all.set(t.id_str, t); } } catch {}
}
const toPost = (id: string) => {
  const t = all.get(id)!;
  const above = []; let p = t.in_reply_to_status_id_str;
  while (p && above.length < 6) { const parent = all.get(p); if (!parent) { above.push({ id: p, available: false }); p = undefined; break; } above.push(embeddedPost(parent)); p = parent.in_reply_to_status_id_str; }
  return { id, available: true, text: displayText(t), handle: t.user?.screen_name, name: t.user?.name, postedAt: t.created_at, media: (t.mediaDetails ?? []).map(toXMedia),
    referenced: t.quoted_tweet ? { ...embeddedPost(t.quoted_tweet), kind: "quoted" } : t.in_reply_to_status_id_str ? { kind: "replied_to", text: "old-style reply text" } : null,
    thread: { posts: above.reverse(), complete: !p } };
};
const photos = [...all.values()].flatMap((t) => (t.mediaDetails ?? []).filter((m) => m.type === "photo").map(toXMedia));
const posts = ["2120117369561559321", "2120067945800016080", "2119494480269095235", "2119941247389282488", "2120225581656621302"].map(toPost);
posts.push({ ...toPost("2050466058050379866"), id: "3", media: photos.slice(0, 3) });
posts.push({ ...toPost("2050466058050379866"), id: "4", media: photos.slice(0, 4), thread: null, referenced: null });
writeFileSync(".preview/posts.json", JSON.stringify(posts, null, 1));
console.log(posts.length, photos.length);

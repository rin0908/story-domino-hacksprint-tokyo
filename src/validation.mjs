// This fixed program runs in Daytona. Story text is data in an environment variable,
// never executable code. Local execution is only used by the automated tests.
export function buildValidationCode() {
  return `import json, os
payload = json.loads(os.environ["STORY_DOMINO_INPUT"])
original = payload.get("original", {})
proposal = payload.get("proposal", {})
scenes = proposal.get("scenes", []) if isinstance(proposal, dict) else []
is_list = isinstance(scenes, list)
if not is_list: scenes = []
ids = [s.get("id") if isinstance(s, dict) else None for s in scenes]
integer_ids = all(type(i) is int for i in ids)
unique = integer_ids and len(set(ids)) == len(ids)
expected = set(range(1, 6))
actual = set(ids) if integer_ids else set()
shape = is_list and all(isinstance(s, dict) and isinstance(s.get("title"), str) and 0 < len(s["title"].strip()) <= 120 and isinstance(s.get("text"), str) and 0 < len(s["text"].strip()) <= 3000 for s in scenes)
checks = []
def check(id, label, passed, detail):
    checks.append({"id": id, "label": label, "passed": bool(passed), "detail": detail})
check("ids", "場面IDが整数の1〜5", integer_ids and actual <= expected, "整数IDのみを許可します。")
check("unique", "場面IDに重複がない", unique, "同じIDの場面は1つだけ必要です。")
check("complete", "必要な5場面がすべて存在", len(scenes) == 5 and actual == expected, "場面1・2・3・4・5がそれぞれ必要です。")
check("content", "全場面にタイトルと本文がある", shape, "空の本文・不正な形式・過大な文章を検査します。")
for id in (1, 2):
    before = next((s for s in original.get("scenes", []) if s.get("id") == id), None)
    after = [s for s in scenes if isinstance(s, dict) and type(s.get("id")) is int and s["id"] == id]
    preserved = before is not None and len(after) == 1 and after[0].get("title") == before.get("title") and after[0].get("text") == before.get("text")
    check("preserved-" + str(id), "場面" + str(id) + "の内容を維持", preserved, "タイトルと本文を元の文字列と完全一致で比較します。")
metadata = isinstance(proposal, dict) and all(isinstance(proposal.get(k), str) and 0 < len(proposal[k].strip()) <= 3000 for k in ("reason", "ending"))
check("metadata", "変更理由とオチがある", metadata, "文字列の存在と長さを検査します。")
result = {"valid": all(c["passed"] for c in checks), "checks": checks, "scope": "コードによる形式検査です。文章の意味や、すべての矛盾を検出する検査ではありません。内容の整合性は人が確認してください。"}
print(json.dumps(result, ensure_ascii=False))
`;
}

# UI/API contract

All routes are same-origin, no secrets in browser. JSON bodies for POST; failures are {error:{code,message,stage?}}.

- GET /api/story → STORY object (src/story.mjs).
- GET /api/status → {services:[{id:'neo4j'|'nosana'|'daytona',name,state:'missing'|'configured'|'checking'|'connected'|'failed',message,missing:[envName],checkedAt:null|string}], readiness:{ready:boolean}, event:{conditions:'未確認',submission:'未確認',deadline:'未確認'}}. Configuration alone is not connectivity.
- POST /api/check-connections {} → same status. Runs actual minimal checks; failed service does not prevent other checks.
- POST /api/impact {} → {runId,affectedIds:[...],preservedIds:[1,2],source:'neo4j',paths:[{sceneId,path:[strings]}],query:string}. Color live cards ONLY from affectedIds returned here. No fallback.
- POST /api/generate {runId} → {runId,proposal:{scenes:[{id,title,text}],reason,ending},source:'nosana',model:string}. Previous successful real short Nosana check is required.
- POST /api/validate {runId} → {runId,validation:{valid:boolean,checks:[{id,label,passed,detail}],scope:string},source:'daytona',exitCode:number}. Semantic correctness is explicitly out of scope. Validation failures disable adoption.
- POST /api/adopt {runId} → {scenes,ending,premise,adopted:true}. Server must require validation for this stored run. Original story is immutable. State is per run, not global.
- POST /api/undo {runId} → {scenes,ending,premise,adopted:false}. Restores original content.
- GET /api/sample → {label:'サンプル：事前に作成した例（AI生成・スポンサー実行なし）',affectedIds:[3,4,5],proposal:...}. Separate explicit sample mode only. Sample adopt/undo can be client-local. Never represent it as provider evidence.

Pipeline order: check connections (separate button) → impact → generate → validate. UI can automatically perform the three pipeline POSTs sequentially on the main change button, showing each stage/progress and actual failure; render partial impact even if generation fails. Never copy original scenes over model results before validation. Keep all five cards central. On adoption update cards; undo restores full original. Separate sample state so it cannot submit to live adoption. Display disclaimer, event unconfirmed, no keys/URLs. Network calls in UI use JSON Content-Type. UI implementation files: public/index.html, public/app.js, public/styles.css only.

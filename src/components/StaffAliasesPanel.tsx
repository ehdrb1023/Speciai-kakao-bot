'use client';

// 우리측 카톡 닉네임 등록. 여기 없는 이름은 전부 거래처측으로 표시된다.
// 등록 전에는 우리 직원 발화도 왼쪽(흰 말풍선)에 붙어 대화 방향이 헷갈린다.

import { useState, useTransition } from 'react';
import { Ic } from './console/IconDefs';

export function StaffAliasesPanel({
  aliases,
  canEdit,
  saveAction,
}: {
  aliases: string[];
  canEdit: boolean;
  saveAction: (aliases: string[]) => Promise<{ error?: string; reclassified?: number }>;
}) {
  const [list, setList] = useState<string[]>(aliases);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(next: string[]) {
    setList(next);
    start(async () => {
      const res = await saveAction(next);
      if (res.error) {
        setMsg(`저장 실패: ${res.error}`);
        return;
      }
      if (!res.reclassified) {
        setMsg('저장했어요.');
        return;
      }
      // 받은 카톡 화면은 이미 불러온 대화를 들고 있어서, 서버에서 side 를 고쳐도
      // 그 방을 다시 열기 전까지 옛 색 그대로다. 몇 건이 바뀌었는지 알린 뒤 새로 불러온다.
      setMsg(`저장했어요. 지난 메시지 ${res.reclassified}건의 표시를 다시 맞췄습니다. 화면을 새로 불러옵니다…`);
      window.setTimeout(() => window.location.reload(), 1200);
    });
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="sh" style={{ marginBottom: 10 }}>
        <Ic id="i-id" w={15} />
        <b>우리측 카톡 닉네임</b>
      </div>
      <div className="fhint" style={{ marginBottom: 10 }}>
        여기 등록한 이름의 발화만 대화창 오른쪽(노란 말풍선)에 표시됩니다. 카톡에서 쓰는 실제 닉네임을
        그대로 넣으세요. 3자 이상이면 부분일치도 잡습니다.
        <br />
        저장하면 <b>이미 쌓인 대화의 표시도 함께 다시 맞춥니다.</b>
      </div>

      {list.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {list.map((a) => (
            <span key={a} className="chipx wt">
              {a}
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`${a} 삭제`}
                  disabled={pending}
                  onClick={() => save(list.filter((x) => x !== a))}
                  style={{ marginLeft: 4, color: 'var(--fnt)', fontWeight: 800 }}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : (
        <div className="placeholder" style={{ marginBottom: 10 }}>
          아직 등록된 닉네임이 없어요. 지금은 모든 발화가 거래처측으로 표시됩니다.
        </div>
      )}

      {canEdit ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="tin"
            style={{ flex: '1 1 200px' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                save([...list, draft.trim()]);
                setDraft('');
              }
            }}
            placeholder="카톡 닉네임 (예: 신동규)"
            aria-label="추가할 닉네임"
          />
          <button
            type="button"
            className="btn pri sm"
            disabled={pending || !draft.trim()}
            onClick={() => {
              save([...list, draft.trim()]);
              setDraft('');
            }}
          >
            추가
          </button>
        </div>
      ) : null}

      {msg ? <div className="fhint">{msg}</div> : null}
    </div>
  );
}

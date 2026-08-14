'use client';

// 발신 표시 이름. 대시보드에서 쓴 글이 카톡방에 `[이 이름] 본문` 으로 나간다.
// 거래처가 보는 이름이라 아이디(martin1023)가 그대로 나가면 곤란하다.

import { useState, useTransition } from 'react';

export function DisplayNamePanel({
  current,
  saveAction,
}: {
  current: string;
  saveAction: (name: string) => Promise<{ error?: string; name?: string }>;
}) {
  const [value, setValue] = useState(current);
  const [saved, setSaved] = useState(current);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const preview = value.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();

  function save() {
    start(async () => {
      const res = await saveAction(value);
      if (res.error) {
        setMsg(`저장 실패: ${res.error}`);
        return;
      }
      setSaved(res.name ?? value);
      setValue(res.name ?? value);
      setMsg('저장했어요. 다음에 보내는 것부터 이 이름으로 나갑니다.');
    });
  }

  return (
    <div className="card">
      <div className="card-h">
        <div>
          <h2>내 발신 이름</h2>
          <div className="desc">보낸 메시지에 함께 남는 이름입니다.</div>
        </div>
      </div>
      <div className="frow">
        <div>
          <div className="fl">이름</div>
          <div className="fd">
            대시보드에서 보낸 글은 거래처 방에 <b>[{preview || '이름'}] 내용</b> 형태로 나갑니다.
            봇 계정 하나로 여러 담당자가 답하기 때문에, 접두가 없으면 거래처는 누가 말하는지 알 수
            없습니다. 거래처가 보는 이름이니 실명이나 직함으로 두세요. 담당자별로 각자 설정하고,
            이미 나간 메시지는 바뀌지 않습니다.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <input
            className="input"
            style={{ flex: '0 1 320px' }}
            value={value}
            maxLength={40}
            onChange={(e) => setValue(e.target.value)}
            placeholder="김담당"
            aria-label="발신 이름"
          />
          <button type="button" className="btn primary" disabled={pending || !preview || preview === saved} onClick={save}>
            저장
          </button>
          {msg ? (
            <div className="note" style={{ flexBasis: '100%', margin: 0 }}>
              {msg}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

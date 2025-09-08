'use client';
import { useState } from 'react';
import BeadCanvas from '@/components/BeadCanvas';
import Footer from '@/components/Footer';

export default function Page() {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <main style={{ maxWidth: 900, width: '100%', margin: 'auto', padding: '1rem 1rem 7rem 1rem' }}>
      {/* タイトル行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '2rem', margin: 0 }}>Bead Designer</h1>
        <button
          onClick={() => setShowHelp(true)}
          className="w-8 h-8 flex items-center justify-center rounded-full border border-gray-300 bg-white hover:bg-gray-100"
          title="使い方を表示"
        >
          ?
        </button>
      </div>

      <p style={{ marginTop: '0.5rem', color: '#555' }}>
        ビーズをリングごとに配置し、設計図をSVGとして書き出せます。
      </p>

      <BeadCanvas />

      {/* ヘルプモーダル */}
      {showHelp && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={() => setShowHelp(false)}
        >
          <div
            style={{
              background: 'white',
              padding: '1.5rem',
              borderRadius: '0.5rem',
              maxWidth: '600px',
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>使い方</h2>
            <ul style={{ listStyle: 'disc', paddingLeft: '1.25rem', lineHeight: 1.6 }}>
              <li>中心ビーズを選べます。</li>
              <li>リングの半径やグリッド分割数を調整して、ビーズを等間隔に配置できます。</li>
              <li>下のボタンからビーズを配置できます。グリッド数以上には追加できません。</li>
              <li>ビーズはドラッグして移動、ダブルクリックで削除できます。</li>
              <li>プレビューモードにすると、全リング・全ビーズを表示できます。</li>
              <li>完成した設計図は「SVG書き出し」から保存可能です。</li>
            </ul>
            <div style={{ textAlign: 'right', marginTop: '1rem' }}>
              <button
                onClick={() => setShowHelp(false)}
                className="px-3 py-1 border rounded bg-white hover:bg-gray-100"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </main>
  );
}

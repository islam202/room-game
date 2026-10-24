import React, { useState, useEffect } from 'react';

export default function App() {
  const [roomCode, setRoomCode] = useState('');
  const [isInRoom, setIsInRoom] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [appError, setAppError] = useState('');

  useEffect(() => {
    try {
      // قراءة الـ Hash أو الـ Search بأمان مطلق
      const hash = window.location.hash;
      const params = new URLSearchParams(window.location.search);
      let code = '';

      if (hash && hash.includes('room=')) {
        code = hash.split('room=')[1];
      } else if (params.get('room')) {
        code = params.get('room');
      }

      if (code) {
        setRoomCode(code.trim().toUpperCase());
        setIsInRoom(true);
      }
    } catch (err) {
      setAppError(err.message || String(err));
    }
  }, []);

  const createRoom = () => {
    try {
      const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
      setRoomCode(randomCode);
      setIsInRoom(true);
      window.location.hash = `room=${randomCode}`;
    } catch (err) {
      setAppError(err.message);
    }
  };

  const joinRoom = () => {
    try {
      if (inputCode.trim() !== '') {
        const code = inputCode.trim().toUpperCase();
        setRoomCode(code);
        setIsInRoom(true);
        window.location.hash = `room=${code}`;
      }
    } catch (err) {
      setAppError(err.message);
    }
  };

  const leaveRoom = () => {
    setIsInRoom(false);
    setRoomCode('');
    setInputCode('');
    window.location.hash = '';
  };

  // إذا حدث أي خطأ برمجي، سيظهر لك هنا مباشرة بدلاً من الشاشة البيضاء
  if (appError) {
    return (
      <div className="min-h-screen bg-red-950 text-white flex flex-col items-center justify-center p-4">
        <div className="bg-red-900 border border-red-700 p-6 rounded-2xl max-w-md w-full text-center shadow-2xl">
          <h2 className="text-xl font-bold mb-2">⚠️ حدث خطأ في التطبيق</h2>
          <p className="bg-red-950 p-3 rounded font-mono text-sm text-red-300 break-all mb-4">
            {appError}
          </p>
          <button 
            onClick={() => window.location.href = window.location.pathname}
            className="bg-white text-red-950 font-bold px-4 py-2 rounded-xl">
            إعادة تحميل الصفحة
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-800 rounded-2xl shadow-2xl p-6 border border-gray-700">
        <h1 className="text-3xl font-extrabold text-center mb-6 text-indigo-400">
          🎮 Room Game
        </h1>

        {!isInRoom ? (
          <div className="space-y-4">
            <button
              onClick={createRoom}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition shadow-lg">
              إنشاء غرفة جديدة
            </button>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-gray-700"></div>
              <span className="flex-shrink mx-4 text-gray-400 text-sm">أو</span>
              <div className="flex-grow border-t border-gray-700"></div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="أدخل كود الغرفة"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-white uppercase font-mono focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={joinRoom}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl transition shadow-lg">
                انضمام
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-6">
            <div className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
              <p className="text-sm text-gray-400 mb-1">كود الغرفة الحالي:</p>
              <span className="text-2xl font-mono font-bold text-yellow-400 tracking-wider">
                {roomCode}
              </span>
            </div>

            <div className="p-4 bg-gray-900 rounded-xl border border-gray-800">
              <p className="text-gray-300">أنت الآن داخل الغرفة وجاهز للعب!</p>
            </div>

            <button
              onClick={leaveRoom}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 px-4 rounded-xl transition shadow-lg">
              مغادرة الغرفة
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';

export default function App() {
  const [roomCode, setRoomCode] = useState('');
  const [isInRoom, setIsInRoom] = useState(false);
  const [inputCode, setInputCode] = useState('');

  // قراءة الغرفة من الـ Hash عند فتح الرابط المباشر
  useEffect(() => {
    try {
      const hash = window.location.hash;
      if (hash && hash.includes('room=')) {
        const code = hash.replace('#room=', '').trim().toUpperCase();
        if (code) {
          setRoomCode(code);
          setIsInRoom(true);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const createRoom = () => {
    const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    setRoomCode(randomCode);
    setIsInRoom(true);
    window.location.hash = `room=${randomCode}`;
  };

  const joinRoom = () => {
    if (inputCode.trim() !== '') {
      const code = inputCode.trim().toUpperCase();
      setRoomCode(code);
      setIsInRoom(true);
      window.location.hash = `room=${code}`;
    }
  };

  const leaveRoom = () => {
    setIsInRoom(false);
    setRoomCode('');
    setInputCode('');
    window.location.hash = '';
  };

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
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition">
              إنشاء غرفة جديدة
            </button>

            <div className="flex gap-2 pt-2">
              <input
                type="text"
                placeholder="كود الغرفة"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-white uppercase font-mono focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={joinRoom}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl transition">
                انضمام
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-6">
            <div className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
              <p className="text-sm text-gray-400 mb-1">كود الغرفة:</p>
              <span className="text-2xl font-mono font-bold text-yellow-400">
                {roomCode}
              </span>
            </div>

            <p className="text-gray-300">أنت متصل وجاهز للعب!</p>

            <button
              onClick={leaveRoom}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 px-4 rounded-xl transition">
              مغادرة الغرفة
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

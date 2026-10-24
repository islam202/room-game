import React, { useState, useEffect } from 'react';

export default function App() {
  const [currentRoom, setCurrentRoom] = useState('lobby');
  const [roomCode, setRoomCode] = useState('');
  const [inputCode, setInputCode] = useState('');

  // قراءة كود الغرفة من الـ Hash بأمان تام لمنع الشاشة البيضاء
  useEffect(() => {
    try {
      const hash = window.location.hash;
      if (hash && hash.includes('room=')) {
        const roomFromHash = hash.split('room=')[1];
        if (roomFromHash) {
          setRoomCode(roomFromHash.toUpperCase());
          setCurrentRoom('game');
        }
      }
    } catch (error) {
      console.error("Error reading room from hash:", error);
    }
  }, []);

  const createRoom = () => {
    const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    setRoomCode(randomCode);
    setCurrentRoom('game');
    window.location.hash = `room=${randomCode}`;
  };

  const joinRoom = () => {
    if (inputCode.trim() !== '') {
      const code = inputCode.toUpperCase();
      setRoomCode(code);
      setCurrentRoom('game');
      window.location.hash = `room=${code}`;
    }
  };

  const leaveRoom = () => {
    setCurrentRoom('lobby');
    setRoomCode('');
    setInputCode('');
    window.location.hash = '';
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-800 rounded-2xl shadow-2xl p-6 border border-gray-700">
        <h1 className="text-3xl font-extrabold text-center mb-6 text-indigo-400 tracking-wide">
          🎮 Room Game
        </h1>

        {currentRoom === 'lobby' ? (
          <div className="space-y-4">
            <button
              onClick={createRoom}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition duration-200 shadow-lg">
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
                className="flex-1 bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 uppercase font-mono"
              />
              <button
                onClick={joinRoom}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl transition duration-200 shadow-lg">
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

            <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
              <p className="text-gray-300">أنت الآن داخل الغرفة وجاهز للعب مع أصدقائك!</p>
            </div>

            <button
              onClick={leaveRoom}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 px-4 rounded-xl transition duration-200 shadow-lg">
              مغادرة الغرفة
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

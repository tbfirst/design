import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { authService } from './authService';
import PhysicsBottleBackground from './scenes/PhysicsBottleBackground';

/**
 * 前端登录组件：Login
 * 其中的组件与前端登录功能相关，交互时可发送请求
 */
const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasUsername, setHasUsername] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const enterRotateY = (location.state as { fromRegister?: boolean } | null)?.fromRegister ? 90 : -90;

  // 进 /login 即清掉本地旧 token / user / expiresAt，避免"同浏览器换账号"时
  // 瞬间被踢回上一个用户的主页（errorConclude #39 Bug 1）。
  // 原来这里有个自动跳转逻辑（token 未过期则 navigate 到 /admin 或 /workspace），
  // 会让想切账号的用户根本看不到表单，已删除。
  useEffect(() => {
    authService.logout({ silent: true });
  }, []);

  // 处理登录表单提交，调用 authService.login 进行登录，并根据用户角色导航到不同页面
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await authService.login(username, password);

      setIsLoading(false);

      // 登录后一律进入沉浸式首页 /home（管理员仍可从顶栏 / 地址栏进入 /admin）
      navigate('/home');
    } catch (err: any) {
      setError(err.message || '登录失败，请检查账号密码');
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <PhysicsBottleBackground />
      <motion.div
        initial={{ rotateY: enterRotateY, opacity: 0 }}
        animate={{ rotateY: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ transformOrigin: 'center', perspective: 1200 }}
        className="relative z-10 w-full max-w-md bg-white/80 backdrop-blur-md rounded-3xl shadow-xl border border-slate-100 p-8"
      >
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">内部协作平台</h1>
          <p className="text-sm text-slate-500 mt-2">请使用管理员分配的账号登录</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl font-medium text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div className={`relative transition-all duration-200 ${hasUsername ? 'opacity-100' : 'opacity-60 hover:opacity-80'}`}>
            <label className={`block text-sm font-bold mb-2 ${hasUsername ? 'text-cyan-600' : 'text-slate-700'}`}>账号</label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setHasUsername(e.target.value.length > 0); }}
              className={`w-full bg-white/70 border rounded-xl px-4 py-3 focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-all text-slate-800 outline-none ${hasUsername ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-slate-300'}`}
              placeholder="输入员工账号"
              required
            />
          </div>

          <div className={`relative transition-all duration-200 ${hasPassword ? 'opacity-100' : 'opacity-60 hover:opacity-80'}`}>
            <div className="flex items-center justify-between mb-2">
              <label className={`text-sm font-bold ${hasPassword ? 'text-cyan-600' : 'text-slate-700'}`}>密码</label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setHasPassword(e.target.value.length > 0); }}
              className={`w-full bg-white/70 border rounded-xl px-4 py-3 focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-all text-slate-800 outline-none ${hasPassword ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-slate-300'}`}
              placeholder="输入密码"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-8"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : '登录'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-500">
          没有账号？
          <button
            type="button"
            onClick={() => navigate('/register', { state: { fromLogin: true } })}
            className="ml-1 text-indigo-600 hover:text-indigo-700 font-semibold bg-transparent border-none cursor-pointer p-0"
          >
            立即注册
          </button>
        </div>
        <div className="mt-3 text-center">
          <p className="text-xs text-slate-400">忘记密码请联系系统管理员</p>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;

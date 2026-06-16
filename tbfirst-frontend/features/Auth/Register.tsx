import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { authService } from './authService';
import PhysicsBottleBackground from './scenes/PhysicsBottleBackground';

/**
 * 注册页 —— 支持可选"申请成立资源共享组"。
 *
 * 2026-04-21 起：所有注册一律走一级管理员审批流程。
 *  - 提交注册后用户永远处于 status='pending'，后端不下发 token；
 *  - 若勾选 applyGroup：响应里同时带 pendingApplicationId（建组申请也要审批）；
 *  - 前端统一展示"已提交，等待管理员审核"，2.5 秒后跳回登录页。
 */
const Register: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const enterRotateY = (location.state as { fromLogin?: boolean } | null)?.fromLogin ? -90 : 90;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [hasUsername, setHasUsername] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [hasPasswordConfirm, setHasPasswordConfirm] = useState(false);

  const [applyGroup, setApplyGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');

  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (password !== passwordConfirm) {
      setError('两次输入的密码不一致');
      return;
    }
    // 邮箱已改为必填：它现在是"按邮箱邀请加入共享组"的查找键，
    // 且 V3 的 partial unique index 要求非空时不得重复。前端先做一次格式兜底，
    // 即使用户绕过 HTML required，后端也会再校一次 @NotBlank @Email。
    const emailTrimmed = email.trim();
    if (!emailTrimmed) {
      setError('请填写邮箱');
      return;
    }
    // 简单的 RFC 5322 子集：aaa@bbb.ccc；复杂校验交给后端 @Email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setError('邮箱格式不正确');
      return;
    }
    if (applyGroup && groupName.trim().length < 2) {
      setError('组名至少 2 个字符');
      return;
    }
    setIsLoading(true);
    try {
      const resp = await authService.register({
        username: username.trim(),
        password,
        nickname: nickname.trim() || undefined,
        email: emailTrimmed,
        applyGroup: applyGroup
          ? { name: groupName.trim(), description: groupDescription.trim() || undefined }
          : undefined,
      });

      // 2026-04-21 起：注册一律进 pending，后端不下发 token
      const msg = applyGroup && resp.pendingApplicationId
        ? `注册已提交（用户 id ${resp.pendingRegistrationId ?? resp.userId}）。同时提交的建组申请编号 ${resp.pendingApplicationId}，两项均需一级管理员审批。`
        : `注册已提交（用户 id ${resp.pendingRegistrationId ?? resp.userId}）。请等待一级管理员审批通过后再登录。`;
      setInfo(msg);
      setIsLoading(false);
      setTimeout(() => navigate('/login', { replace: true }), 3000);
      return;
    } catch (err: any) {
      setError(err?.message || '注册失败，请稍后重试');
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
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-50 rounded-2xl mb-3">
            <UserPlus className="w-6 h-6 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">注册新账号</h1>
          <p className="text-sm text-slate-500 mt-2">创建个人账号，或同时申请成立共享组</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl text-center">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm rounded-xl text-center">
            {info}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className={`relative transition-all duration-200 ${hasUsername ? 'opacity-100' : 'opacity-60 hover:opacity-80'}`}>
            <label className={`block text-sm font-bold mb-1 ${hasUsername ? 'text-cyan-600' : 'text-slate-700'}`}>账号</label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setHasUsername(e.target.value.length > 0); }}
              className={`w-full bg-white/70 border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-all text-slate-800 outline-none ${hasUsername ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-slate-300'}`}
              placeholder="3-32 位，唯一"
              minLength={3}
              maxLength={32}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">昵称（选填）</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full px-4 py-2.5 bg-white/70 border border-slate-300 rounded-xl focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 outline-none text-slate-800 transition-all"
              maxLength={64}
            />
          </div>
          <div className={`relative transition-all duration-200 ${hasEmail ? 'opacity-100' : 'opacity-60 hover:opacity-80'}`}>
            <label className={`block text-sm font-bold mb-1 ${hasEmail ? 'text-cyan-600' : 'text-slate-700'}`}>邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setHasEmail(e.target.value.length > 0); }}
              className={`w-full bg-white/70 border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-all text-slate-800 outline-none ${hasEmail ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-slate-300'}`}
              placeholder="必填：组长按此邮箱邀请你加入共享组"
              maxLength={64}
              required
            />
          </div>
          <div className={`relative transition-all duration-200 ${hasPassword ? 'opacity-100' : 'opacity-60 hover:opacity-80'}`}>
            <div className="flex items-center justify-between mb-1">
              <label className={`text-sm font-bold ${hasPassword ? 'text-cyan-600' : 'text-slate-700'}`}>密码</label>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setHasPassword(e.target.value.length > 0); }}
              className={`w-full bg-white/70 border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-all text-slate-800 outline-none ${hasPassword ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-slate-300'}`}
              minLength={6}
              maxLength={64}
              required
            />
          </div>
          <div className={`relative transition-all duration-200 ${hasPasswordConfirm ? 'opacity-100' : 'opacity-60 hover:opacity-80'}`}>
            <label className={`block text-sm font-bold mb-1 ${hasPasswordConfirm ? 'text-cyan-600' : 'text-slate-700'}`}>确认密码</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={passwordConfirm}
              onChange={(e) => { setPasswordConfirm(e.target.value); setHasPasswordConfirm(e.target.value.length > 0); }}
              className={`w-full bg-white/70 border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-all text-slate-800 outline-none ${hasPasswordConfirm ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-slate-300'}`}
              minLength={6}
              maxLength={64}
              required
            />
          </div>

          {/* 资源共享组申请 */}
          <div className="border-t border-slate-100 pt-4">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={applyGroup}
                onChange={(e) => setApplyGroup(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              申请成立资源共享组（作为组长 / 二级管理员）
            </label>

            {applyGroup && (
              <div className="mt-3 space-y-3 pl-6 border-l-2 border-indigo-100">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">组名</label>
                  <input
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    placeholder="2-64 字；全局唯一"
                    minLength={2}
                    maxLength={64}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">简介（选填）</label>
                  <textarea
                    value={groupDescription}
                    onChange={(e) => setGroupDescription(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none min-h-[60px]"
                    maxLength={1000}
                    placeholder="组的用途、服务对象，方便管理员审批"
                  />
                </div>
                <p className="text-xs text-slate-400">
                  提交后需要一级管理员批准，才会自动建组并把你设为组长。
                </p>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2 mt-2"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              '注册'
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-500">
          已有账号？
          <button
            type="button"
            onClick={() => navigate('/login', { state: { fromRegister: true } })}
            className="ml-1 text-indigo-600 hover:text-indigo-700 font-semibold bg-transparent border-none cursor-pointer p-0"
          >
            返回登录
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default Register;

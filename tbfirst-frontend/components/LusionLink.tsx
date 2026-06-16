import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface LusionLinkProps {
  label: string;
  onClick: () => void;
  isActive?: boolean;
  activeColor?: string;
  defaultColor?: string;
  className?: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;

const LusionLink: React.FC<LusionLinkProps> = ({
  label,
  onClick,
  isActive = false,
  activeColor = '#6366f1',
  defaultColor,
  className = '',
}) => {
  const [hov, setHov] = useState(false);
  const chars = label.split('');

  const color = isActive ? activeColor : (defaultColor ?? undefined);

  return (
    <button
      className={`relative overflow-hidden font-bold text-xs ${className}`}
      style={{ height: '1.25em', color }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
    >
      {/* first row: exits upward on hover */}
      <motion.span
        className="flex whitespace-nowrap"
        animate={{ y: hov ? '-120%' : '0%' }}
        transition={{ duration: 0.38, ease: EASE }}
      >
        {chars.map((ch, i) => (
          <motion.span
            key={i}
            style={{ display: 'inline-block' }}
            animate={{ y: hov ? '-2px' : '0px' }}
            transition={{ duration: 0.32, ease: EASE, delay: hov ? i * 0.016 : 0 }}
          >
            {ch === ' ' ? ' ' : ch}
          </motion.span>
        ))}
      </motion.span>

      {/* second row: enters from below on hover */}
      <motion.span
        className="absolute inset-0 flex items-center whitespace-nowrap"
        animate={{ y: hov ? '0%' : '120%' }}
        transition={{ duration: 0.38, ease: EASE }}
      >
        {chars.map((ch, i) => (
          <motion.span
            key={i}
            style={{ display: 'inline-block' }}
            animate={{ y: hov ? '0px' : '2px' }}
            transition={{ duration: 0.32, ease: EASE, delay: hov ? i * 0.016 : 0 }}
          >
            {ch === ' ' ? ' ' : ch}
          </motion.span>
        ))}
      </motion.span>
    </button>
  );
};

export default LusionLink;

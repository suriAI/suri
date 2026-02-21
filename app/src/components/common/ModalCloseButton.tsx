interface ModalCloseButtonProps {
  onClick: () => void;
}

export function ModalCloseButton({ onClick }: ModalCloseButtonProps) {
  return (
    <button
      onClick={onClick}
      className="w-7 h-7 -mt-3 -mr-3 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all"
    >
      <i className="fa-solid fa-xmark text-xs"></i>
    </button>
  );
}

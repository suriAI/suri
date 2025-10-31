export default function WindowFooter() {
  return (
    <div 
      className="z-60 fixed bottom-0 w-full h-5 bg-gradient-surface flex items-center justify-between select-none flex-shrink-0 border-t border-white/[0.08]"
    >
      <div className="flex justify-end mr-3 space-x-2 flex-1">
        <div className="text-white/60 text-xs font-medium">v1.0.0</div>
      </div>
    </div>
  )
}
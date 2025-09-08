// --- Footer (sticky) ---
function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer
      className="fixed bottom-0 left-0 w-full border-t text-sm text-gray-600 bg-white z-50 pt-3 pb-5"
      style={{ paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="max-w-2xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="font-medium">© {year} Yuri Saito. All rights reserved.</div>
        <a
          href="https://ko-fi.com/bluecopper_v"
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1 border rounded bg-white hover:bg-gray-100"
        >
          ☕ Buy me a coffee
        </a>
      </div>
    </footer>
  );
}

export default Footer;

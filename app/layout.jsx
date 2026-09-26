import "./style.css";

export const metadata = {
  title: "Blogauto | 글쓰기 작업실",
  description: "네이버 블로그 글 생성과 클라우드 발행",
};

export default function RootLayout({ children }) {
  return <html lang="ko"><body>{children}</body></html>;
}

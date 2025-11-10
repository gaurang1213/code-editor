
import { Footer } from "@/features/home/footer";
import { Header } from "@/features/home/header";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";
// import { usePathname } from "next/navigation";

export const metadata: Metadata = {
    title: {
        template: "code - Editor ",
        default: "Code Editor For coders - code",
    },
};

export default function HomeLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            <Header />

            <main className="z-20 relative w-full pt-0 md:pt-0  ">

                {children}
            </main>
        </>
    );
}

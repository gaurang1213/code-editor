import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

export default function Home() {
   
  return (
    <div className=" z-20 flex flex-col items-center justify-start min-h-screen py-2 mt-10">
    
      <Link href={"/dashboard"}>
        <Button variant={"brand"} className="mb-4" size={"lg"}>
          Get Started
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Button>
      </Link>
    </div>
  );
}

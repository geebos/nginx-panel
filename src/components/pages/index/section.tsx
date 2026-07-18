import * as React from "react";
import {
  Card,
} from "@/components/ui/card";

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="scroll-mt-24 py-16 bg-secondary text-foreground"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-2">
          <h2 className="font-heading text-[34px] font-semibold leading-[1.47] tracking-[-0.374px]">
            {title}
          </h2>
          <p className="text-[17px] leading-[1.47] tracking-[-0.374px] text-muted-foreground">
            {description}
          </p>
        </div>
        <Card className="p-6">
          <div className="flex flex-col gap-8">{children}</div>
        </Card>
      </div>
    </section>
  );
}

export function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[14px] font-normal leading-[1.43] tracking-[-0.224px] text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

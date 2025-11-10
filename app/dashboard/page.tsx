import AddNewButton from "@/features/dashboard/components/add-new-btn";
import { JoinPlaygroundDialog } from "@/features/dashboard/components/join-playground-dialog";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import ProjectTable from "@/features/dashboard/components/project-table";
import { getAllPlaygroundForUser , deleteProjectById ,editProjectById , duplicateProjectById} from "@/features/playground/actions";

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center py-16">
    <h2 className="text-xl font-semibold text-gray-500">No projects found</h2>
    <p className="text-gray-400">Create a new project to get started!</p>
  </div>
);

const DashboardMainPage = async () => {
  const playgrounds = await getAllPlaygroundForUser();
  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)] mx-auto w-full max-w-6xl px-6 py-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full items-stretch">
        <AddNewButton />
        <JoinPlaygroundDialog>
          <div
            className="group px-6 py-6 flex flex-row justify-between items-center border rounded-lg bg-muted cursor-pointer 
            transition-all duration-300 ease-in-out
            hover:bg-background hover:border-[#E93F3F] hover:scale-[1.02]
            shadow-[0_2px_10px_rgba(0,0,0,0.08)]
            hover:shadow-[0_10px_30px_rgba(233,63,63,0.15)]"
          >
            <div className="flex flex-row justify-center items-start gap-4">
              <Button
                variant={"outline"}
                className="flex justify-center items-center bg-white group-hover:bg-[#fff8f8] group-hover:border-[#E93F3F] group-hover:text-[#E93F3F] transition-colors duration-300"
                size={"icon"}
              >
                <Users className="h-6 w-6" />
              </Button>
              <div className="flex flex-col">
                <h1 className="text-xl font-bold text-[#e93f3f]">Join Playground</h1>
                <p className="text-sm text-muted-foreground max-w-[220px]">Enter an existing playground ID</p>
              </div>
            </div>
          </div>
        </JoinPlaygroundDialog>
      </div>
      <div className="mt-8 flex flex-col items-stretch w-full">
        {playgrounds && playgrounds.length === 0 ? (
          <EmptyState />
        ) : (
          // @ts-ignore,
          <ProjectTable
            projects={playgrounds || []}
            onDeleteProject={deleteProjectById}
            onUpdateProject={editProjectById}
            onDuplicateProject={duplicateProjectById}
          />
        )}
      </div>
    </div>
  );
};

export default DashboardMainPage;

import { ReactNode, useContext, useState } from "react";

// components
import { AdminView, AdminIconButton, Loading } from "@/components";

// context
import { GlobalStateContext } from "@context/GlobalContext";

export const PageContainer = ({
  children,
  isLoading,
  headerText,
}: {
  children: ReactNode;
  isLoading: boolean;
  headerText?: string;
}) => {
  const { error, isAdmin } = useContext(GlobalStateContext);
  const [showSettings, setShowSettings] = useState(false);

  if (isLoading) return <Loading />;

  return (
    <div className="p-2 mb-28 min-h-[100vh]">
      {isAdmin && (
        <AdminIconButton setShowSettings={() => setShowSettings(!showSettings)} showSettings={showSettings} />
      )}
      {headerText && (
        <div className="pb-3">
          <h2>{headerText}</h2>
        </div>
      )}
      {showSettings ? <AdminView /> : children}
      {error && <p className="p3 pt-10 text-center text-error">{error}</p>}
    </div>
  );
};

export default PageContainer;

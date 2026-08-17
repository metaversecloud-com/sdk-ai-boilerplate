export const AdminIconButton = ({
  setShowSettings,
  showSettings,
}: {
  setShowSettings: (value: boolean) => void;
  showSettings: boolean;
}) => {
  return (
    <button className="btn btn-icon icon-with-rounded-border mb-4" onClick={() => setShowSettings(showSettings)}>
      <img src={`https://sdk-style.s3.amazonaws.com/icons/${showSettings ? "arrow" : "cog"}.svg`} />
    </button>
  );
};

export default AdminIconButton;

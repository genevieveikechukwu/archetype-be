const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Journal = sequelize.define(
    "Journal",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      entry_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      entry_text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "journals",
      timestamps: false,
    },
  );

  return Journal;
};

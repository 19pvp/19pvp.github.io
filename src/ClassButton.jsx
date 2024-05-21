import { h } from 'preact';
import { wowClasses } from './wowclasses';

const ClassButton = () => {
  return (
    <div className="flex flex-wrap justify-center space-x-4">
      {wowClasses.map(className => (
        <button
          key={className}
          className="class-button px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-opacity-50"
        >
          {className}
        </button>
      ))}
    </div>
  );
};

export default ClassButton;